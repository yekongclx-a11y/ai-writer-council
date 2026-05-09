"""
独立测试脚本：验证 call_llm 能成功调通 Claude。
用法：uv run python test_llm.py
"""

from dotenv import load_dotenv
load_dotenv()  # 必须在 import call_llm 之前，确保环境变量已就位

from backend.llm import call_llm

if __name__ == "__main__":
    result = call_llm(
        role="writer",
        messages=[{"role": "user", "content": "请用一句话介绍你自己。"}],
    )
    print(result)
