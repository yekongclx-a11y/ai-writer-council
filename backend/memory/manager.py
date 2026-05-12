"""
章节摘要记忆管理器。

职责：
- 每轮结束后接收章节摘要，存入 projects/<项目名>/memory.json
- 下一轮启动前加载历史摘要，格式化为 {memory_context} 字符串注入所有委员
"""

import json
import re
from pathlib import Path

PROJECTS_DIR = Path(__file__).resolve().parent.parent.parent / "projects"

DEFAULT_MEMORY: dict = {
    "summaries": [],
    "round_count": 0,
}


def _slugify(name: str) -> str:
    """将项目名转为安全的目录名。"""
    name = name.strip() or "default"
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name[:120]


def _memory_path(project_name: str) -> Path:
    return PROJECTS_DIR / _slugify(project_name) / "memory.json"


def load(project_name: str) -> dict:
    """加载项目的记忆文件，不存在时返回空结构。"""
    path = _memory_path(project_name)
    if not path.exists():
        return dict(DEFAULT_MEMORY)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def save(project_name: str, data: dict) -> None:
    """保存记忆到项目的 memory.json。"""
    path = _memory_path(project_name)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def format_context(memory: dict) -> str:
    """将记忆数据格式化为 {memory_context} 注入用的纯文本段落。

    输出格式示例：
        【前情摘要】
        第 1 轮：陈默在废弃仓库发现烧焦的提货单，林晓薇出现，两人第一次正面交锋。
        第 2 轮：陈默翻墙进入港口办公室，发现货运记录，林晓薇跟踪而至。
    """
    summaries = memory.get("summaries", [])
    if not summaries:
        return ""
    lines = ["【前情摘要】"]
    for i, s in enumerate(summaries, 1):
        lines.append(f"第 {i} 轮：{s}")
    return "\n".join(lines)
