"""回填 暗流 项目 output.md 的轮次标题，以 memory.json 中的 summary 前 40 字替换。

用法：python scripts/backfill_titles.py
"""

import json
import re
from pathlib import Path

PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects"
SLUG = "暗流"

memory_path = PROJECTS_DIR / SLUG / "memory.json"
output_path = PROJECTS_DIR / SLUG / "output.md"

if not memory_path.exists():
    print("❌ memory.json 不存在")
    exit(1)
if not output_path.exists():
    print("❌ output.md 不存在")
    exit(1)

memory = json.loads(memory_path.read_text(encoding="utf-8"))
summaries = memory.get("summaries", [])
print(f"📖 memory.json 载入：{len(summaries)} 条摘要")

content = output_path.read_text(encoding="utf-8")
original = content

# 匹配每个轮次标题
def replace_title(match):
    round_num = int(match.group(1))
    idx = round_num - 1  # summaries 从 0 开始，第 1 轮对应 summaries[0]
    if idx < len(summaries):
        summary = summaries[idx]
        title = (summary[:40] if summary else f"第{round_num}轮").strip()
        print(f"  第{round_num}轮: 「{match.group(2)}」→「{title}」")
        return f"# 第{round_num}轮：{title}"
    return match.group(0)

content = re.sub(r'^# 第(\d+)轮：(.+)$', replace_title, content, flags=re.MULTILINE)

if content == original:
    print("✅ 无需修改")
else:
    output_path.write_text(content, encoding="utf-8")
    print(f"✅ output.md 已更新")
