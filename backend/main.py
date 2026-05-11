from __future__ import annotations
import asyncio
import os
import re
import threading
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from backend.workflow.orchestrator import run_decision, stream_decision
from backend.workflow.schemas import Setting, RoundBrief

app = FastAPI(title="AI 作家委员会")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
ENV_PATH = Path(__file__).parent.parent / ".env"

# provider → (key_env, url_env, official_default_url)
_PROVIDERS = {
    "claude": (
        "ANTHROPIC_API_KEY",
        "ANTHROPIC_BASE_URL",
        "https://api.anthropic.com",
    ),
    "deepseek": (
        "DEEPSEEK_API_KEY",
        "DEEPSEEK_BASE_URL",
        "https://api.deepseek.com",
    ),
    "gemini": (
        "GEMINI_API_KEY",
        "GEMINI_BASE_URL",
        "https://generativelanguage.googleapis.com/v1beta/openai",
    ),
}


def _read_env_file() -> dict[str, str]:
    """从 .env 文件读取所有已知字段，缺失字段返回空字符串。"""
    all_keys = {k for p in _PROVIDERS.values() for k in p[:2]}
    values: dict[str, str] = {k: "" for k in all_keys}
    if not ENV_PATH.exists():
        return values
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" in line:
            key, _, val = line.partition("=")
            key = key.strip()
            if key in values:
                values[key] = val.strip()
    return values


def _write_env_field(key: str, value: str) -> None:
    """在 .env 文件中更新或追加单个字段，保留注释和其他行。"""
    if not ENV_PATH.exists():
        ENV_PATH.write_text(f"{key}={value}\n", encoding="utf-8")
        return
    content = ENV_PATH.read_text(encoding="utf-8")
    pattern = re.compile(rf"^({re.escape(key)}\s*=).*$", re.MULTILINE)
    if pattern.search(content):
        content = pattern.sub(rf"\g<1>{value}", content)
    else:
        if not content.endswith("\n"):
            content += "\n"
        content += f"{key}={value}\n"
    ENV_PATH.write_text(content, encoding="utf-8")


# ── Settings 数据模型 ────────────────────────────────────────────────────────

class ProviderUpdate(BaseModel):
    key: str = ""       # 空字符串 = 不修改
    base_url: str = ""  # 空字符串 = 不修改


class SettingsPayload(BaseModel):
    claude:   ProviderUpdate = ProviderUpdate()
    deepseek: ProviderUpdate = ProviderUpdate()
    gemini:   ProviderUpdate = ProviderUpdate()


# ── Settings 端点 ────────────────────────────────────────────────────────────

@app.get("/api/settings")
def get_settings():
    """
    返回每个 provider 的配置状态。
    key_configured: bool — key 是否已填写（不返回 key 值本身）
    base_url: str — 当前 base_url（空字符串表示将使用官方默认）
    default_base_url: str — 官方默认地址（前端展示用）
    """
    env = _read_env_file()
    result = {}
    for name, (key_env, url_env, default_url) in _PROVIDERS.items():
        result[name] = {
            "key_configured": bool(env.get(key_env, "")),
            "base_url": env.get(url_env, ""),
            "default_base_url": default_url,
        }
    return result


@app.post("/api/settings")
def post_settings(payload: SettingsPayload):
    data = payload.model_dump()
    for name, (key_env, url_env, _) in _PROVIDERS.items():
        provider_data = data[name]
        new_key = provider_data["key"].strip()
        new_url = provider_data["base_url"].strip()

        if new_key:
            _write_env_field(key_env, new_key)
            os.environ[key_env] = new_key

        # base_url 允许设置为空（表示使用官方默认）
        if new_url != "":
            _write_env_field(url_env, new_url)
            os.environ[url_env] = new_url
        elif provider_data["base_url"] == "__clear__":
            _write_env_field(url_env, "")
            os.environ.pop(url_env, None)

    return {"ok": True}


# ── HTTP 端点（保留，方便命令行测试）────────────────────────────────────────

class RunRequest(BaseModel):
    setting: Setting
    brief: RoundBrief


@app.post("/api/run")
def api_run(req: RunRequest):
    result = run_decision(req.setting, req.brief)
    return result.model_dump()


# ── WebSocket 端点 ────────────────────────────────────────────────────────────

@app.websocket("/ws/run")
async def ws_run(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        req = RunRequest(**data)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"请求格式错误：{e}"})
        await websocket.close()
        return

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()

    def producer():
        try:
            for event in stream_decision(req.setting, req.brief):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except Exception as e:
            loop.call_soon_threadsafe(
                queue.put_nowait, {"type": "error", "message": str(e)}
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)  # 结束哨兵

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()

    try:
        while True:
            event = await queue.get()
            if event is None:
                break
            await websocket.send_json(event)
    except WebSocketDisconnect:
        pass
    finally:
        thread.join(timeout=5)
        await websocket.close()


# ── 静态文件（必须最后挂载，否则会拦截 API 请求）────────────────────────────

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
