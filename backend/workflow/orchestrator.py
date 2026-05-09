from __future__ import annotations
import json
from datetime import datetime, timezone

from backend.llm import call_llm
from .schemas import Setting, RoundBrief, RoundResult


# ── 辅助函数 ──────────────────────────────────────────────────────────────────

def _log(round_log: list[dict], role: str, mode: str, output: str) -> None:
    round_log.append({
        "role": role,
        "mode": mode,
        "output": output,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


def _parse_json(text: str) -> dict:
    return json.loads(text)


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


def _fmt_brief(brief: RoundBrief) -> str:
    must_inc = "、".join(brief.must_include) or "（无）"
    must_av = "、".join(brief.must_avoid) or "（无）"
    return (
        f"【本轮指令（Round Brief）】\n"
        f"场景概述：{brief.scene_brief}\n"
        f"场景背景：{brief.scene_setting}\n"
        f"涉及角色：{', '.join(brief.involved_characters) or '（无指定）'}\n"
        f"目标：{brief.goal}\n"
        f"必须包含：{must_inc}\n"
        f"必须避免：{must_av}\n"
        f"目标字数：{brief.target_length}\n"
        f"本轮节奏：{brief.pace_for_this_round or '（跟随设定）'}\n"
        f"情感弧线：{brief.emotional_arc or '（未指定）'}\n"
        f"前情摘要：{brief.prev_summary or '（无）'}\n"
        f"上一段结尾：{brief.last_paragraph or '（无）'}"
    )


# ── 核心编排 ──────────────────────────────────────────────────────────────────

def run_decision(setting: Setting, brief: RoundBrief) -> RoundResult:
    """
    跑一次完整决议。串行调用 5 委员，遵循既定流程。
    MVP 阶段修订上限 1 轮。
    """
    round_log: list[dict] = []
    setting_str = _fmt_setting(setting)
    brief_str = _fmt_brief(brief)

    # ── 步骤 1：主编制定场景大纲 ──────────────────────────────────────────────
    outline_raw = call_llm(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            "请以 mode=outline 制定本场景大纲，严格按 JSON 格式输出。"
        )}],
        mode="outline",
    )
    _log(round_log, "editor_in_chief", "outline", outline_raw)
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
    draft = call_llm(
        role="writer",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"{outline_str}\n\n"
            "请以 mode=draft 写正文初稿，直接输出正文，无需 JSON。"
        )}],
        mode="draft",
    )
    _log(round_log, "writer", "draft", draft)

    # ── 步骤 3：批评家审稿 ────────────────────────────────────────────────────
    critic_raw = call_llm(
        role="critic",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{outline_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            "请审阅初稿，严格按 JSON 格式输出。"
        )}],
    )
    _log(round_log, "critic", "review", critic_raw)
    critic_result = _parse_json(critic_raw)

    # ── 步骤 4：一致性委员校对 ────────────────────────────────────────────────
    consistency_raw = call_llm(
        role="consistency_officer",
        messages=[{"role": "user", "content": (
            f"{setting_str}\n\n"
            f"{brief_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            "请校对一致性，严格按 JSON 格式输出。"
        )}],
    )
    _log(round_log, "consistency_officer", "check", consistency_raw)
    consistency_result = _parse_json(consistency_raw)

    # ── 步骤 5：主编 review → 决定是否修订 ───────────────────────────────────
    critic_str = json.dumps(critic_result, ensure_ascii=False, indent=2)
    consistency_str = json.dumps(consistency_result, ensure_ascii=False, indent=2)

    review_raw = call_llm(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{outline_str}\n\n"
            f"【作家初稿】\n{draft}\n\n"
            f"【批评家反馈】\n{critic_str}\n\n"
            f"【一致性委员反馈】\n{consistency_str}\n\n"
            "请以 mode=review 做修订决策，严格按 JSON 格式输出。"
        )}],
        mode="review",
    )
    _log(round_log, "editor_in_chief", "review", review_raw)
    review = _parse_json(review_raw)

    # ── 步骤 5b（条件）：作家修订（MVP 1 轮封顶）────────────────────────────
    if review.get("decision") == "request_revision":
        revision_instr = review.get("revision_instructions", "")
        conflict_str = json.dumps(review.get("conflict_resolution", {}), ensure_ascii=False)

        final_draft = call_llm(
            role="writer",
            messages=[{"role": "user", "content": (
                f"【初稿】\n{draft}\n\n"
                f"【批评家反馈】\n{critic_str}\n\n"
                f"【一致性委员反馈】\n{consistency_str}\n\n"
                f"【主编修订指令】\n{revision_instr}\n\n"
                f"【优先级裁定】\n{conflict_str}\n\n"
                "请以 mode=revise 修订，直接输出修订后正文，无需 JSON。"
            )}],
            mode="revise",
        )
        _log(round_log, "writer", "revise", final_draft)
    else:
        # approve_draft：初稿直接通过
        final_draft = draft

    # ── 步骤 6：润色师打磨 ────────────────────────────────────────────────────
    highlights_str = json.dumps(critic_result.get("highlights", []), ensure_ascii=False, indent=2)
    style_str = (
        f"语气={setting.style.tone} 节奏={setting.style.pace} 视角={setting.style.pov}"
    )

    polish_raw = call_llm(
        role="polisher",
        messages=[{"role": "user", "content": (
            f"【待润色稿】\n{final_draft}\n\n"
            f"【批评家亮点（必须保留）】\n{highlights_str}\n\n"
            f"【作品风格】\n{style_str}\n\n"
            "请润色，严格按 JSON 格式输出。"
        )}],
    )
    _log(round_log, "polisher", "polish", polish_raw)
    polish_result = _parse_json(polish_raw)

    scene_text = polish_result.get("polished_text", final_draft)

    # ── 步骤 7：主编 finalize → 重大决策标记 ─────────────────────────────────
    finalize_raw = call_llm(
        role="editor_in_chief",
        messages=[{"role": "user", "content": (
            f"{outline_str}\n\n"
            f"【最终成品】\n{scene_text}\n\n"
            f"【批评家反馈】\n{critic_str}\n\n"
            f"【主编 review 决策】\n{review_raw}\n\n"
            "请以 mode=finalize 标记本轮重大决策，严格按 JSON 格式输出。"
        )}],
        mode="finalize",
    )
    _log(round_log, "editor_in_chief", "finalize", finalize_raw)
    finalize_result = _parse_json(finalize_raw)
    major_decisions = finalize_result.get("major_decisions", [])

    return RoundResult(
        scene_text=scene_text,
        round_log=round_log,
        major_decisions=major_decisions,
        metadata={},
    )
