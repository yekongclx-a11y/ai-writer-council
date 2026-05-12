from __future__ import annotations
import json
import re
from datetime import datetime, timezone
from typing import Generator

import json_repair

from backend.llm import call_llm
from backend.llm.config_loader import get_committee_config
from backend.memory import load as load_memory, save as save_memory, format_context as fmt_memory
from .schemas import Setting, RoundBrief, RoundResult


# ── 辅助函数 ──────────────────────────────────────────────────────────────────

def _parse_json(text: str) -> dict:
    cleaned = re.sub(r'^\s*```(?:json)?\s*\n?', '', text.strip())
    cleaned = re.sub(r'\n?```\s*$', '', cleaned).strip()
    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        pass
    # json_repair 兜底：处理 LLM 输出中未转义引号等轻微格式错误
    try:
        result = json_repair.loads(cleaned)
        if isinstance(result, (dict, list)):
            return result
    except Exception:
        pass
    preview = repr(cleaned[:200])
    raise ValueError(f"LLM 输出无法解析为 JSON（json_repair 也无法修复）\n原文片段：{preview}")


# ── 消息构建 ──────────────────────────────────────────────────────────────────

def _fmt_setting(setting: Setting) -> str:
    chars = "\n".join(
        f"  - {c.name}（{c.role}）：{c.description} 语气：{c.voice}"
        for c in setting.characters
    ) or "  （无）"
    forbidden = "、".join(setting.constraints.forbidden_themes + setting.constraints.forbidden_devices) or "（无）"
    return (
        f"【作品设定】\n"
        f"标题：{setting.title}\n"
        f"题材：{setting.genre}\n"
        f"世界观：{setting.world_view}\n"
        f"角色档案：\n{chars}\n"
        f"风格：语气={setting.style.tone} 节奏={setting.style.pace} 视角={setting.style.pov}\n"
        f"禁忌：{forbidden}"
    )


def _inflate_target(target: int) -> int:
    """将用户设定字数上浮 20%，补偿标点/换行占位导致的纯汉字脱水率。"""
    return round(target * 1.2 / 100) * 100


def _fmt_brief(brief: RoundBrief) -> str:
    must_inc = "、".join(brief.must_include) or "（无）"
    must_av = "、".join(brief.must_avoid) or "（无）"
    inflated = _inflate_target(brief.target_length)
    return (
        f"【本轮指令（Round Brief）】\n"
        f"场景概述：{brief.scene_brief}\n"
        f"场景背景：{brief.scene_setting}\n"
        f"涉及角色：{', '.join(brief.involved_characters) or '（无指定）'}\n"
        f"目标：{brief.goal}\n"
        f"必须包含：{must_inc}\n"
        f"必须避免：{must_av}\n"
        f"目标字数：{inflated}（含标点，纯汉字须达到约 {brief.target_length} 字）\n"
        f"本轮节奏：{brief.pace_for_this_round or '（跟随设定）'}\n"
        f"情感弧线：{brief.emotional_arc or '（未指定）'}\n"
        f"前情摘要：{brief.prev_summary or '（无）'}\n"
        f"上一段结尾：{brief.last_paragraph or '（无）'}"
    )


def _make_step(role: str, mode: str, output: str) -> dict:
    return {
        "type": "step",
        "role": role,
        "mode": mode,
        "output": output,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── 记忆上下文注入 ─────────────────────────────────────────────────────────────

_WITH_MEMORY_CACHE: dict[str, str] = {}  # role → original system_prompt from YAML


def _get_system_prompt(role: str) -> str:
    """读取委员的原始 system_prompt（带 {memory_context} 占位符）。"""
    if role not in _WITH_MEMORY_CACHE:
        config = get_committee_config(role)
        _WITH_MEMORY_CACHE[role] = config["system_prompt"]
    return _WITH_MEMORY_CACHE[role]


def _call_with_memory(
    role: str,
    messages: list[dict],
    memory_context: str,
    **overrides,
) -> str:
    """同 call_llm，但自动将 {memory_context} 替换为实际记忆内容。"""
    system_prompt = _get_system_prompt(role).replace("{memory_context}", memory_context)
    return call_llm(role, messages, system_prompt=system_prompt, **overrides)


# ── 流式编排（核心）──────────────────────────────────────────────────────────

def stream_decision(setting: Setting, brief: RoundBrief) -> Generator[dict, None, None]:
    """
    跑一次完整决议，每完成一个委员步骤就 yield 一条 type=step 事件。
    最后 yield 一条 type=done 事件，包含 scene_text / major_decisions / round_log。
    MVP 阶段修订上限 1 轮。
    """
    round_log: list[dict] = []
    setting_str = _fmt_setting(setting)
    brief_str = _fmt_brief(brief)

    # 记忆系统：跨轮记忆，注入 {memory_context}
    project_name = brief.session_id or setting.title
    memory_data = load_memory(project_name)
    memory_context = fmt_memory(memory_data)

    def emit(role: str, mode: str, output: str) -> dict:
        event = _make_step(role, mode, output)
        round_log.append({k: v for k, v in event.items() if k != "type"})
        return event

    # ── 步骤 1：主编制定场景大纲 ──────────────────────────────────────────────
    outline_raw = _call_with_memory(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"请以 mode=outline 制定本场景大纲，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
        mode="outline",
    )
    yield emit("editor_in_chief", "outline", outline_raw)
    outline = _parse_json(outline_raw)

    outline_str = (
        f"【主编场景大纲】\n"
        f"场景核心：{outline.get('scene_summary', '')}\n"
        f"基调：{outline.get('tone', '')}\n"
        f"节拍：\n" +
        "\n".join(
            f"  {b.get('id', i+1)}. {b.get('description', '')}（目的：{b.get('purpose', '')}）"
            for i, b in enumerate(outline.get("beats", []))
        ) +
        f"\n给作家的提醒：{outline.get('notes_for_writer', '')}"
    )

    # ── 步骤 2：作家写初稿 ────────────────────────────────────────────────────
    draft = _call_with_memory(
        role="writer",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"{outline_str}\n\n"
            "请以 mode=draft 写正文初稿，直接输出正文，无需 JSON。"
        )}],
        memory_context=memory_context,
        mode="draft",
    )
    yield emit("writer", "draft", draft)

    # ── 步骤 3：批评家审稿 ────────────────────────────────────────────────────
    critic_raw = _call_with_memory(
        role="critic",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{outline_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            "请审阅初稿，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
    )
    yield emit("critic", "review", critic_raw)
    critic_result = _parse_json(critic_raw)

    # ── 步骤 4：一致性委员校对 ────────────────────────────────────────────────
    consistency_raw = _call_with_memory(
        role="consistency_officer",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            "请校对一致性，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
    )
    yield emit("consistency_officer", "check", consistency_raw)
    consistency_result = _parse_json(consistency_raw)

    # ── 步骤 5：主编 review → 决定是否修订 ───────────────────────────────────
    critic_str = json.dumps(critic_result, ensure_ascii=False, indent=2)
    consistency_str = json.dumps(consistency_result, ensure_ascii=False, indent=2)

    review_raw = _call_with_memory(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{outline_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            f"【批评家反馈】\n{critic_str}\n\n"
            f"【一致性委员反馈】\n{consistency_str}\n\n"
            "请以 mode=review 做修订决策，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
        mode="review",
    )
    yield emit("editor_in_chief", "review", review_raw)
    review = _parse_json(review_raw)

    # ── 步骤 5b（条件）：作家修订（MVP 1 轮封顶）────────────────────────────
    if review.get("decision") == "request_revision":
        revision_instr = review.get("revision_instructions", "")
        conflict_str = json.dumps(review.get("conflict_resolution", {}), ensure_ascii=False)

        final_draft = _call_with_memory(
            role="writer",
            messages=[{"role": "user", "content": (
                f"【初稿】\n{draft}\n\n"
                f"【批评家反馈】\n{critic_str}\n\n"
                f"【一致性委员反馈】\n{consistency_str}\n\n"
                f"【主编修订指令】\n{revision_instr}\n\n"
                f"【优先级裁定】\n{conflict_str}\n\n"
                "请以 mode=revise 修订，直接输出修订后正文，无需 JSON。"
            )}],
            memory_context=memory_context,
            mode="revise",
        )
        yield emit("writer", "revise", final_draft)
    else:
        final_draft = draft

    # ── 步骤 6：润色师打磨 ────────────────────────────────────────────────────
    highlights_str = json.dumps(critic_result.get("highlights", []), ensure_ascii=False, indent=2)
    style_str = f"语气={setting.style.tone} 节奏={setting.style.pace} 视角={setting.style.pov}"

    polish_raw = _call_with_memory(
        role="polisher",
        messages=[{"role": "user", "content": (
            f"【待润色稿】\n{final_draft}\n\n"
            f"【批评家亮点（必须保留）】\n{highlights_str}\n\n"
            f"【作品风格】\n{style_str}\n\n"
            "请润色，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
    )
    yield emit("polisher", "polish", polish_raw)
    scene_text = polish_raw.strip()

    # ── 步骤 7：主编 finalize → 重大决策标记 ─────────────────────────────────
    finalize_raw = _call_with_memory(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{outline_str}\n\n"
            f"【最终成品】\n{scene_text}\n\n"
            f"【批评家反馈】\n{critic_str}\n\n"
            f"【主编 review 决策】\n{review_raw}\n\n"
            "请以 mode=finalize 标记本轮重大决策，严格按 JSON 格式输出。"
        )}],
        memory_context=memory_context,
        mode="finalize",
    )
    yield emit("editor_in_chief", "finalize", finalize_raw)
    finalize_result = _parse_json(finalize_raw)
    major_decisions = finalize_result.get("major_decisions", [])

    # ── 步骤 8：主编生成章节摘要 ────────────────────────────────────────────────
    summary = _call_with_memory(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"请用 2-3 句话概括以下场景内容，作为本章节摘要。\n"
            f"只输出摘要本身，不要附加说明、不要 JSON 包装。\n\n"
            f"{scene_text}"
        )}],
        memory_context=memory_context,
        temperature=0.3,
        max_tokens=500,
    )
    summary = summary.strip().strip('"').strip("'").strip()
    yield emit("editor_in_chief", "chapter_summary", summary)

    # 持久化记忆：追加摘要到 projects/<项目名>/memory.json
    memory_data["summaries"].append(summary)
    memory_data["round_count"] += 1
    save_memory(project_name, memory_data)

    yield {
        "type": "done",
        "scene_text": scene_text,
        "major_decisions": major_decisions,
        "round_log": round_log,
        "chapter_summary": summary,
        "metadata": {},
    }


# ── HTTP 端点用的薄包装 ───────────────────────────────────────────────────────

def run_decision(setting: Setting, brief: RoundBrief) -> RoundResult:
    """收集 stream_decision 的全部事件，返回 RoundResult。HTTP /api/run 使用。"""
    scene_text = ""
    major_decisions: list = []
    round_log: list = []

    for event in stream_decision(setting, brief):
        if event["type"] == "done":
            scene_text = event["scene_text"]
            major_decisions = event["major_decisions"]
            round_log = event["round_log"]

    return RoundResult(
        scene_text=scene_text,
        round_log=round_log,
        major_decisions=major_decisions,
        metadata={},
    )
