from __future__ import annotations
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Generator

import json_repair

from backend.llm import call_llm
from backend.llm.client import LLMResult
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
        f"上一段结尾：{brief.last_paragraph or '（无）'}\n"
        f"特殊指令：{brief.special_instruction or '（无）'}"
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
) -> LLMResult:
    """同 call_llm，但自动将 {memory_context} 替换为实际记忆内容。返回 LLMResult。"""
    system_prompt = _get_system_prompt(role).replace("{memory_context}", memory_context)
    return call_llm(role, messages, system_prompt=system_prompt, **overrides)


# ── 三档会长参与度 ────────────────────────────────────────────────────────────

def _make_outline_message(
    setting_str: str,
    brief_str: str,
    scene_brief: str,
) -> str:
    """根据场景概述长度决定主编参与度。"""
    length = len(scene_brief.strip())

    if length == 0:
        return (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            "会长本轮未指定具体场景内容。请基于以下信息自主推进剧情：\n"
            "1. 前情摘要中已发生的事件\n"
            "2. 上一段结尾的文字\n"
            "3. 作品设定和世界观\n\n"
            "你需要自行判断故事目前的发展阶段，决定本轮最自然的推进方向。\n"
            "请以 mode=outline 制定本场景大纲，严格按 JSON 格式输出。"
        )
    elif length < 30:
        return (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"会长给出了简短的场景方向：「{scene_brief}」\n"
            "请将其扩展为一份完整的场景大纲，在保持会长意图的前提下丰富细节和节奏。\n"
            f"请以 mode=outline 制定本场景大纲，严格按 JSON 格式输出。"
        )
    else:
        return (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            "会长已给出详细的场景指令，请严格按以下要求执行，不要自行扩展或修改：\n"
            f"{scene_brief}\n\n"
            f"请以 mode=outline 制定本场景大纲，严格按 JSON 格式输出。"
        )


# ── 流式编排（核心）──────────────────────────────────────────────────────────

# ── 用量追踪与持久化 ──────────────────────────────────────────────────────────


def _load_usage(project_slug: str) -> dict:
    """从 usage.json 加载用量记录。"""
    path = Path(__file__).resolve().parent.parent.parent / "projects" / project_slug / "usage.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"rounds": [], "total_input_tokens": 0, "total_output_tokens": 0}


def _save_usage(project_slug: str, usage: dict) -> None:
    """保存用量记录到 usage.json。"""
    path = Path(__file__).resolve().parent.parent.parent / "projects" / project_slug / "usage.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(usage, ensure_ascii=False, indent=2), encoding="utf-8")


# ── 带重试的步骤执行 ───────────────────────────────────────────────────────────


def _exec_step(
    role: str,
    mode: str,
    call_fn: Callable[[], LLMResult],
    emit: Callable[[str, str, str], None],
    on_step_error: Callable[[str, str, str], str] | None = None,
    default_output: str = "",
) -> Generator[dict, None, tuple[str, int, int, bool]]:
    """执行一个 LLM 步骤，支持重试和跳过。

    Yields:
        每个阶段（正常/异常/跳过）的 step 事件。

    Returns:
        (output_text, input_tokens, output_tokens, was_skipped)
    """
    for attempt in range(2):  # 原始 + 1 次重试
        try:
            result = call_fn()
            yield emit(role, mode, result.text)
            return result.text, result.input_tokens, result.output_tokens, False
        except Exception as e:
            if attempt > 0 or not on_step_error:
                # 重试后仍失败，或没有重试机制
                if on_step_error:
                    yield emit(role, mode, f"[已跳过] {e}")
                    return default_output, 0, 0, True
                raise  # 没有 on_step_error 时传播异常
            # 首次失败：弹出重试对话框
            yield emit(role, mode, f"[执行异常] {e}")
            decision = on_step_error(role, mode, str(e))
            if decision == "retry":
                continue
            return default_output, 0, 0, True
    yield emit(role, mode, "[已跳过] 重试耗尽")
    return default_output, 0, 0, True


# ── 流式编排（核心）──────────────────────────────────────────────────────────

def stream_decision(
    setting: Setting,
    brief: RoundBrief,
    on_step_error: Callable[[str, str, str], str] | None = None,
) -> Generator[dict, None, None]:
    """
    跑一次完整决议，每完成一个委员步骤就 yield 一条 type=step 事件。
    最后 yield 一条 type=done 事件，包含 scene_text / major_decisions / round_log / usage。
    MVP 阶段修订上限 1 轮。
    """
    round_log: list[dict] = []
    setting_str = _fmt_setting(setting)
    brief_str = _fmt_brief(brief)

    # 用量累计
    total_input_tokens = 0
    total_output_tokens = 0

    # 记忆系统：跨轮记忆，注入 {memory_context}
    project_name = brief.session_id or setting.title
    _slug = re.sub(r"\s+", "_", (project_name or "").strip() or "default")
    _slug = re.sub(r'[<>:"/\\|?*]', "", _slug)[:120]
    memory_data = load_memory(project_name)
    memory_context = fmt_memory(memory_data)

    def emit(role: str, mode: str, output: str) -> dict:
        event = _make_step(role, mode, output)
        round_log.append({k: v for k, v in event.items() if k != "type"})
        return event

    def call_with_usage(
        role: str,
        messages: list[dict],
        memory_context: str,
        **overrides,
    ) -> LLMResult:
        """_call_with_memory 封装，自动收集用量。"""
        result = _call_with_memory(role, messages, memory_context, **overrides)
        nonlocal total_input_tokens, total_output_tokens
        total_input_tokens += result.input_tokens
        total_output_tokens += result.output_tokens
        return result

    # ── 步骤 1：主编制定场景大纲 ──────────────────────────────────────────────
    outline_raw, _, _, outline_skipped = yield from _exec_step(
        "editor_in_chief", "outline",
        lambda: call_with_usage(
            "editor_in_chief",
            [{"role": "user", "content": _make_outline_message(setting_str, brief_str, brief.scene_brief)}],
            memory_context, mode="outline",
        ),
        emit, on_step_error,
        default_output="{}",
    )
    if outline_skipped:
        outline = {"scene_summary": "（大纲生成已跳过）", "tone": "", "beats": [], "notes_for_writer": ""}
    else:
        try:
            outline = _parse_json(outline_raw)
        except ValueError:
            outline = {"scene_summary": "（大纲格式异常，已使用默认值）", "tone": "", "beats": [], "notes_for_writer": ""}

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
    draft, _, _, draft_skipped = yield from _exec_step(
        "writer", "draft",
        lambda: call_with_usage(
            "writer",
            [{"role": "user", "content": (
                f"{setting_str}\n\n{brief_str}\n\n{outline_str}\n\n"
                "请以 mode=draft 写正文初稿，直接输出正文，无需 JSON。"
            )}],
            memory_context, mode="draft",
        ),
        emit, on_step_error,
        default_output="（初稿生成已跳过）",
    )

    # ── 步骤 3：批评家审稿 ────────────────────────────────────────────────────
    critic_raw, _, _, critic_skipped = yield from _exec_step(
        "critic", "review",
        lambda: call_with_usage(
            "critic",
            [{"role": "user", "content": (
                f"{setting_str}\n\n{outline_str}\n\n"
                f"【作家初稿】\n{draft}\n\n"
                "请审阅初稿，严格按 JSON 格式输出。"
            )}],
            memory_context,
        ),
        emit, on_step_error,
        default_output='{"verdict":"pass","summary":"（审阅已跳过）","highlights":[],"issues":[]}',
    )
    try:
        critic_result = _parse_json(critic_raw)
    except ValueError:
        critic_result = {
            "verdict": "pass",
            "summary": "（批评家本轮输出格式异常，已跳过）",
            "highlights": [],
            "issues": [],
        }

    # ── 步骤 4：一致性委员校对 ────────────────────────────────────────────────
    # 构建跨章节前情概要
    _prev_summaries_text = ""
    if memory_data.get("summaries"):
        _parts = [f"第{i}轮：{s}" for i, s in enumerate(memory_data["summaries"], 1)]
        _prev_summaries_text = "【前情概要】\n" + "\n".join(_parts) + "\n\n"

    consistency_raw, _, _, consistency_skipped = yield from _exec_step(
        "consistency_officer", "check",
        lambda: call_with_usage(
            "consistency_officer",
            [{"role": "user", "content": (
                f"{setting_str}\n\n{brief_str}\n\n"
                f"{_prev_summaries_text}"
                f"【作家初稿】\n{draft}\n\n"
                "请校对一致性，严格按 JSON 格式输出。\n"
                "注意：如果发现与之前轮次的矛盾，请明确指出涉及第几轮。"
            )}],
            memory_context,
        ),
        emit, on_step_error,
        default_output='{"verdict":"consistent","summary":"（校对已跳过）","violations":[]}',
    )
    try:
        consistency_result = _parse_json(consistency_raw)
    except ValueError:
        consistency_result = {
            "verdict": "consistent",
            "summary": "（一致性委员本轮输出格式异常，已跳过）",
            "violations": [],
        }

    # ── 步骤 5：主编 review → 决定是否修订 ───────────────────────────────────
    critic_str = json.dumps(critic_result, ensure_ascii=False, indent=2)
    consistency_str = json.dumps(consistency_result, ensure_ascii=False, indent=2)

    review_raw, _, _, review_skipped = yield from _exec_step(
        "editor_in_chief", "review",
        lambda: call_with_usage(
            "editor_in_chief",
            [{"role": "user", "content": (
                f"{outline_str}\n\n"
                f"【作家初稿】\n{draft}\n\n"
                f"【批评家反馈】\n{critic_str}\n\n"
                f"【一致性委员反馈】\n{consistency_str}\n\n"
                "请以 mode=review 做修订决策，严格按 JSON 格式输出。"
            )}],
            memory_context, mode="review",
        ),
        emit, on_step_error,
        default_output='{"decision":"approve_draft","rationale":"（审阅已跳过）"}',
    )
    if review_skipped:
        review = {"decision": "approve_draft", "rationale": "（审阅已跳过）"}
    else:
        try:
            review = _parse_json(review_raw)
        except ValueError:
            review = {"decision": "approve_draft", "rationale": "（格式异常，默认通过）"}

    # ── 步骤 5b（条件）：作家修订（MVP 1 轮封顶）────────────────────────────
    if review.get("decision") == "request_revision":
        revision_instr = review.get("revision_instructions", "")
        conflict_str = json.dumps(review.get("conflict_resolution", {}), ensure_ascii=False)

        final_draft, _, _, _ = yield from _exec_step(
            "writer", "revise",
            lambda: call_with_usage(
                "writer",
                [{"role": "user", "content": (
                    f"【初稿】\n{draft}\n\n"
                    f"【批评家反馈】\n{critic_str}\n\n"
                    f"【一致性委员反馈】\n{consistency_str}\n\n"
                    f"【主编修订指令】\n{revision_instr}\n\n"
                    f"【优先级裁定】\n{conflict_str}\n\n"
                    "请以 mode=revise 修订，直接输出修订后正文，无需 JSON。"
                )}],
                memory_context, mode="revise",
            ),
            emit, on_step_error,
            default_output=draft,
        )
    else:
        final_draft = draft

    # ── 步骤 6：润色师打磨 ────────────────────────────────────────────────────
    highlights_str = json.dumps(critic_result.get("highlights", []), ensure_ascii=False, indent=2)
    style_str = f"语气={setting.style.tone} 节奏={setting.style.pace} 视角={setting.style.pov}"

    polish_raw, _, _, polish_skipped = yield from _exec_step(
        "polisher", "polish",
        lambda: call_with_usage(
            "polisher",
            [{"role": "user", "content": (
                f"【待润色稿】\n{final_draft}\n\n"
                f"【批评家亮点（必须保留）】\n{highlights_str}\n\n"
                f"【作品风格】\n{style_str}\n\n"
                "请润色，直接输出润色后的完整正文，纯文本，不要 JSON 包装。"
            )}],
            memory_context,
        ),
        emit, on_step_error,
        default_output=final_draft,
    )
    scene_text = polish_raw.strip()

    # ── 步骤 7：主编 finalize → 重大决策标记 ─────────────────────────────────
    finalize_raw, _, _, finalize_skipped = yield from _exec_step(
        "editor_in_chief", "finalize",
        lambda: call_with_usage(
            "editor_in_chief",
            [{"role": "user", "content": (
                f"{outline_str}\n\n"
                f"【最终成品】\n{scene_text}\n\n"
                f"【批评家反馈】\n{critic_str}\n\n"
                f"【主编 review 决策】\n{review_raw}\n\n"
                "请以 mode=finalize 标记本轮重大决策，严格按 JSON 格式输出。"
            )}],
            memory_context, mode="finalize",
        ),
        emit, on_step_error,
        default_output='{"major_decisions":[]}',
    )
    if finalize_skipped:
        finalize_result = {"major_decisions": []}
    else:
        try:
            finalize_result = _parse_json(finalize_raw)
        except ValueError:
            finalize_result = {"major_decisions": []}
    major_decisions = finalize_result.get("major_decisions", [])

    # ── 步骤 7b（可选）：角色演化检测 ──────────────────────────────────────────
    if setting.characters and not finalize_skipped:
        try:
            _evo_chars = [
                {"name": c.name, "role": c.role, "description": c.description, "voice": c.voice}
                for c in setting.characters
            ]
            _evo_round = memory_data.get("round_count", 0) + 1
            _evo_result = call_llm(
                "editor_in_chief",
                [{"role": "user", "content": (
                    f"【本轮成品（第{_evo_round}轮）】\n{scene_text}\n\n"
                    f"【当前角色档案】\n{json.dumps(_evo_chars, ensure_ascii=False, indent=2)}\n\n"
                    "请分析本轮成品中是否出现了角色新行为、新特征、新关系或新技能，"
                    "这些特征在原角色档案中没有记录。\n\n"
                    "如果没有新发现，返回空数组。\n\n"
                    "以 JSON 格式输出（只输出 JSON，不要任何其他文字）：\n"
                    '{"character_evolutions": [\n'
                    '  {"character": "角色名", "new_trait": "新特征描述", '
                    '"evidence": "原文片段证据", "category": "skill|personality|relationship|background"}\n'
                    "]}"
                )}],
                system_prompt="你是一个角色分析助手。严格按 JSON 格式输出，不要附加任何说明文字。",
                temperature=0.2,
                max_tokens=1000,
            )
            _evo_data = _parse_json(_evo_result.text)
            for _ev in _evo_data.get("character_evolutions", []):
                if _ev.get("character") and _ev.get("new_trait"):
                    major_decisions.append({
                        "type": "character_evolution",
                        "character": _ev["character"],
                        "new_trait": _ev["new_trait"],
                        "evidence": _ev.get("evidence", ""),
                        "category": _ev.get("category", "personality"),
                        "description": f"角色「{_ev['character']}」新特征：{_ev['new_trait']}",
                        "rationale": f"来源：第{_evo_round}轮。证据：{_ev.get('evidence', '')}",
                        "reversibility": "high",
                    })
        except Exception:
            pass  # 非关键功能，失败时静默跳过

    # ── 步骤 8：主编生成章节摘要 ────────────────────────────────────────────────
    summary, _, _, _ = yield from _exec_step(
        "editor_in_chief", "chapter_summary",
        lambda: call_with_usage(
            "editor_in_chief",
            [{"role": "user", "content": (
                f"请用 2-3 句话概括以下场景内容，作为本章节摘要。\n"
                f"只输出摘要本身，不要附加说明、不要 JSON 包装。\n\n{scene_text}"
            )}],
            memory_context, temperature=0.3, max_tokens=500,
        ),
        emit, on_step_error,
        default_output="（摘要生成已跳过）",
    )
    summary = summary.strip().strip('"').strip("'").strip()

    # ── 将润色成品追加到 projects/<项目名>/output.md ───────────────────────────
    _out_path = Path(__file__).resolve().parent.parent.parent / "projects" / _slug / "output.md"
    _out_path.parent.mkdir(parents=True, exist_ok=True)
    _round_num = memory_data.get("round_count", 0) + 1
    _summary_title = (
        (summary[:40] if summary and summary != "（摘要生成已跳过）" else brief.scene_brief or f"第{_round_num}轮")
        .strip()
    )
    _entry = (
        f"# 第{_round_num}轮：{_summary_title}\n\n"
        f"{scene_text}\n\n"
        f"---\n状态：[待审]\n\n"
    )
    if _out_path.exists():
        _out_path.write_text(_out_path.read_text(encoding="utf-8") + _entry, encoding="utf-8")
    else:
        _out_path.write_text(_entry, encoding="utf-8")

    # 持久化记忆：追加摘要到 projects/<项目名>/memory.json
    memory_data["summaries"].append(summary)
    memory_data["round_count"] += 1
    save_memory(project_name, memory_data)

    # ── 持久化用量 ─────────────────────────────────────────────────────────────
    usage_data = _load_usage(_slug)
    usage_data["rounds"].append({
        "round": _round_num,
        "input_tokens": total_input_tokens,
        "output_tokens": total_output_tokens,
    })
    usage_data["total_input_tokens"] += total_input_tokens
    usage_data["total_output_tokens"] += total_output_tokens
    _save_usage(_slug, usage_data)

    yield {
        "type": "done",
        "scene_text": scene_text,
        "major_decisions": major_decisions,
        "round_log": round_log,
        "chapter_summary": summary,
        "usage": {
            "input_tokens": total_input_tokens,
            "output_tokens": total_output_tokens,
        },
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
