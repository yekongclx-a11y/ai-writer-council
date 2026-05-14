from __future__ import annotations
import asyncio
import json
import os
import re
import shutil
import threading
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
import yaml
from pydantic import BaseModel

from backend.workflow.orchestrator import run_decision, stream_decision
from backend.workflow.schemas import Setting, RoundBrief, Character, Style, Constraints

app = FastAPI(title="AI 作家委员会")

FRONTEND_DIR = Path(__file__).parent.parent / "frontend"
ENV_PATH = Path(__file__).parent.parent / ".env"
PROJECTS_DIR = Path(__file__).resolve().parent.parent / "projects"


def _slugify(name: str) -> str:
    name = (name or "").strip() or "default"
    name = re.sub(r"\s+", "_", name)
    name = re.sub(r'[<>:"/\\|?*]', "", name)
    return name[:120]


def _load_setting(project_name: str) -> Setting:
    """从 project 文件加载 Setting，不存在时返回空的默认值。"""
    slug = _slugify(project_name)
    base = PROJECTS_DIR / slug

    world = {}
    w_path = base / "world.json"
    if w_path.exists():
        world = json.loads(w_path.read_text(encoding="utf-8"))

    chars = []
    c_path = base / "characters.json"
    if c_path.exists():
        chars = json.loads(c_path.read_text(encoding="utf-8")).get("characters", [])

    return Setting(
        title=world.get("title", project_name),
        genre=world.get("genre", ""),
        world_view=world.get("world_view", ""),
        style=Style(**world.get("style", {})),
        constraints=Constraints(**world.get("constraints", {})),
        characters=[Character(**c) for c in chars],
    )

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
    project_name: str
    brief: RoundBrief


@app.post("/api/run")
def api_run(req: RunRequest):
    setting = _load_setting(req.project_name)
    result = run_decision(setting, req.brief)
    return result.model_dump()


# ── Projects API ────────────────────────────────────────────────────────────────

@app.get("/api/projects")
def list_projects():
    """列出所有项目目录，返回 [{name, slug, has_world, has_chars, round_count}]"""
    if not PROJECTS_DIR.exists():
        return []
    items = []
    for entry in sorted(PROJECTS_DIR.iterdir()):
        if not entry.is_dir() or entry.name.startswith(".") or entry.name.startswith("_"):
            continue
        mem = {}
        m_path = entry / "memory.json"
        if m_path.exists():
            mem = json.loads(m_path.read_text(encoding="utf-8"))
        items.append({
            "name": entry.name,
            "slug": entry.name,
            "has_world": (entry / "world.json").exists(),
            "has_chars": (entry / "characters.json").exists(),
            "round_count": mem.get("round_count", 0),
        })
    return items


class CreateProjectPayload(BaseModel):
    name: str
    genre: str = ""
    world_view: str = ""
    characters: list[dict] = []


@app.post("/api/projects")
def create_project(payload: CreateProjectPayload):
    slug = _slugify(payload.name)
    base = PROJECTS_DIR / slug
    if base.exists():
        return {"ok": False, "error": f"项目 '{payload.name}' 已存在"}
    base.mkdir(parents=True, exist_ok=True)

    # 初始化 world.json
    world = {
        "title": payload.name,
        "genre": payload.genre,
        "world_view": payload.world_view,
        "style": {"tone": "", "pace": "", "pov": ""},
        "constraints": {"forbidden_themes": [], "forbidden_devices": []},
    }
    (base / "world.json").write_text(json.dumps(world, ensure_ascii=False, indent=2), encoding="utf-8")

    # 初始化 characters.json
    chars = {"characters": payload.characters}
    (base / "characters.json").write_text(json.dumps(chars, ensure_ascii=False, indent=2), encoding="utf-8")

    # 初始化 memory.json
    (base / "memory.json").write_text(
        json.dumps({"summaries": [], "round_count": 0}, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return {"ok": True, "slug": slug}


@app.get("/api/projects/{name}/world")
def get_world(name: str):
    base = PROJECTS_DIR / _slugify(name)
    w_path = base / "world.json"
    if not w_path.exists():
        return {}
    return json.loads(w_path.read_text(encoding="utf-8"))


class WorldPayload(BaseModel):
    title: str = ""
    genre: str = ""
    world_view: str = ""
    style: dict = {}
    constraints: dict = {}


@app.put("/api/projects/{name}/world")
def put_world(name: str, payload: WorldPayload):
    base = PROJECTS_DIR / _slugify(name)
    base.mkdir(parents=True, exist_ok=True)
    (base / "world.json").write_text(
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True}


@app.get("/api/projects/{name}/characters")
def get_characters(name: str):
    base = PROJECTS_DIR / _slugify(name)
    c_path = base / "characters.json"
    if not c_path.exists():
        return {"characters": []}
    return json.loads(c_path.read_text(encoding="utf-8"))


class CharactersPayload(BaseModel):
    characters: list[dict] = []


@app.put("/api/projects/{name}/characters")
def put_characters(name: str, payload: CharactersPayload):
    base = PROJECTS_DIR / _slugify(name)
    base.mkdir(parents=True, exist_ok=True)
    (base / "characters.json").write_text(
        json.dumps(payload.model_dump(exclude_none=True), ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True}


class AdoptEvolutionPayload(BaseModel):
    character: str
    new_trait: str
    evidence: str = ""
    category: str = "personality"


@app.post("/api/projects/{name}/adopt_evolution")
def adopt_evolution(name: str, payload: AdoptEvolutionPayload):
    """采纳角色演化建议，更新 characters.json 并记录演化历史。"""
    base = PROJECTS_DIR / _slugify(name)
    c_path = base / "characters.json"
    if not c_path.exists():
        return {"ok": False, "error": "characters.json 不存在"}

    chars_data = json.loads(c_path.read_text(encoding="utf-8"))
    characters = chars_data.get("characters", [])

    found = False
    for c in characters:
        if c.get("name") == payload.character:
            found = True
            if "evolution_history" not in c:
                c["evolution_history"] = []
            c["evolution_history"].append({
                "trait": payload.new_trait,
                "evidence": payload.evidence,
                "category": payload.category,
                "adopted_at": datetime.now(timezone.utc).isoformat(),
            })
            # 附加到角色描述中
            _trait_tag = f"（演化：{payload.new_trait}）"
            if _trait_tag not in c.get("description", ""):
                c["description"] = (c.get("description", "") + " " + _trait_tag).strip()
            break

    if not found:
        return {"ok": False, "error": f"角色「{payload.character}」不存在"}

    c_path.write_text(
        json.dumps(chars_data, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return {"ok": True}


@app.get("/api/projects/{name}/output")
def get_output(name: str):
    """返回 output.md 的内容，纯文本。"""
    base = PROJECTS_DIR / _slugify(name)
    o_path = base / "output.md"
    if not o_path.exists():
        return {"content": ""}
    return {"content": o_path.read_text(encoding="utf-8")}


class OutputUpdatePayload(BaseModel):
    scene_text: str


@app.put("/api/projects/{name}/output")
def put_output(name: str, payload: OutputUpdatePayload):
    """替换 output.md 中最新一轮的正文内容。"""
    base = PROJECTS_DIR / _slugify(name)
    o_path = base / "output.md"
    if not o_path.exists():
        return {"ok": False, "error": "output.md 不存在"}

    content = o_path.read_text(encoding="utf-8")

    # 找到最后一轮的位置（通过最后一个 # 第N轮： 标题）
    headings = list(re.finditer(r'^# 第\d+轮：', content, re.MULTILINE))
    if not headings:
        return {"ok": False, "error": "无法在 output.md 中找到轮次结构"}

    last_start = headings[-1].start()
    last_section = content[last_start:]

    # 在最后一轮内部解析：标题 + 正文 + 分隔线
    section_match = re.match(
        r'(# 第\d+轮：.*?\n\n)(.*?)(\n\n---\n状态：\[.*?\])\s*$',
        last_section, re.DOTALL,
    )
    if not section_match:
        return {"ok": False, "error": "最后一轮结构解析失败"}

    new_content = content[:last_start + section_match.start(2)] + payload.scene_text + content[last_start + section_match.end(2):]
    o_path.write_text(new_content, encoding="utf-8")
    return {"ok": True}


class RenamePayload(BaseModel):
    name: str


@app.delete("/api/projects/{name}")
def delete_project(name: str):
    slug = _slugify(name)
    base = PROJECTS_DIR / slug
    if not base.exists():
        return {"ok": False, "error": "项目不存在"}
    shutil.rmtree(base)
    return {"ok": True}


@app.put("/api/projects/{name}/rename")
def rename_project(name: str, payload: RenamePayload):
    slug = _slugify(name)
    new_slug = _slugify(payload.name)
    base = PROJECTS_DIR / slug
    if not base.exists():
        return {"ok": False, "error": "项目不存在"}
    if (PROJECTS_DIR / new_slug).exists():
        return {"ok": False, "error": f"目标名称「{payload.name}」已存在"}
    base.rename(PROJECTS_DIR / new_slug)
    return {"ok": True, "new_slug": new_slug}


@app.post("/api/projects/{name}/copy")
def copy_project(name: str):
    slug = _slugify(name)
    base = PROJECTS_DIR / slug
    if not base.exists():
        return {"ok": False, "error": "项目不存在"}
    idx = 1
    while (PROJECTS_DIR / f"{slug}_副本{idx}").exists():
        idx += 1
    dest = PROJECTS_DIR / f"{slug}_副本{idx}"
    shutil.copytree(base, dest)
    return {"ok": True, "new_slug": dest.name}


@app.post("/api/projects/{name}/trash")
def trash_project(name: str):
    slug = _slugify(name)
    base = PROJECTS_DIR / slug
    if not base.exists():
        return {"ok": False, "error": "项目不存在"}
    trash_dir = PROJECTS_DIR / "_trash"
    trash_dir.mkdir(exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    dest = trash_dir / f"{slug}_{ts}"
    shutil.move(str(base), str(dest))
    return {"ok": True}


class RewriteRequest(BaseModel):
    project_name: str
    selected_text: str
    context_before: str = ""
    context_after: str = ""
    edit_intent: str = ""


@app.post("/api/rewrite")
def rewrite(req: RewriteRequest):
    """局部修改：LLM 根据选中文本 + 上下文 + 修改意图，返回改写结果。"""
    from backend.llm import call_llm

    system_prompt = (
        "你是一个文字编辑助手。用户会给你一段文本、上下文以及修改意图。\n"
        "请按要求修改选中的文本，只输出修改后的文本，不要附加任何说明。\n"
        "保留原文的语气和风格，除非修改意图明确要求改变风格。\n"
        "不要改动前后文，只输出选中部分修改后的版本。"
    )

    user_prompt = (
        f"【选中文本】\n{req.selected_text}\n\n"
        f"【前文】\n{req.context_before}\n\n"
        f"【后文】\n{req.context_after}\n\n"
        f"【修改意图】\n{req.edit_intent}\n\n"
        "请直接输出修改后的文本。"
    )

    try:
        result = call_llm(
            role="polisher",
            messages=[{"role": "user", "content": user_prompt}],
            system_prompt=system_prompt,
            temperature=0.5,
            max_tokens=2000,
        )
        return {"ok": True, "rewritten_text": result.text.strip()}
    except Exception as e:
        return {"ok": False, "error": str(e)}


@app.get("/api/projects/{name}/memory")
def get_memory(name: str):
    """返回 memory.json 内容。"""
    base = PROJECTS_DIR / _slugify(name)
    m_path = base / "memory.json"
    if not m_path.exists():
        return {"summaries": [], "round_count": 0}
    return json.loads(m_path.read_text(encoding="utf-8"))


# ── Outline API ──────────────────────────────────────────────────────────────

class OutlinePayload(BaseModel):
    content: str


@app.get("/api/projects/{name}/outline")
def get_outline(name: str):
    """返回 outline.md 内容。"""
    base = PROJECTS_DIR / _slugify(name)
    o_path = base / "outline.md"
    if not o_path.exists():
        return {"content": ""}
    return {"content": o_path.read_text(encoding="utf-8")}


@app.put("/api/projects/{name}/outline")
def put_outline(name: str, payload: OutlinePayload):
    """写入 outline.md。"""
    base = PROJECTS_DIR / _slugify(name)
    base.mkdir(parents=True, exist_ok=True)
    (base / "outline.md").write_text(payload.content, encoding="utf-8")
    return {"ok": True}


# ── Committee API ────────────────────────────────────────────────────────────

COMMITTEE_PATH = Path(__file__).resolve().parent.parent / "config" / "committee.yaml"


@app.get("/api/committee")
def get_committee():
    """返回当前委员配置（从 committee.yaml 读取）。"""
    if not COMMITTEE_PATH.exists():
        return {"committees": {}}
    return yaml.safe_load(COMMITTEE_PATH.read_text(encoding="utf-8"))


class MemberConfig(BaseModel):
    name: str = ""
    provider: str = "claude"
    temperature: float = 0.7
    max_tokens: int = 2000


class CommitteePayload(BaseModel):
    committees: dict[str, MemberConfig]


@app.put("/api/committee")
def put_committee(payload: CommitteePayload):
    """写入 committee.yaml 并清除配置缓存。"""
    data = payload.model_dump()
    COMMITTEE_PATH.write_text(
        yaml.dump(data, allow_unicode=True, default_flow_style=False, sort_keys=False),
        encoding="utf-8",
    )
    # 清除 config_loader 的进程内缓存，下次调用重新读取
    from backend.llm import config_loader
    config_loader._committee = None
    config_loader._active_preset = None
    return {"ok": True}


# ── WebSocket 端点 ────────────────────────────────────────────────────────────


class RetryDecision:
    """线程安全的单次重试决策器。"""
    def __init__(self):
        self._event = threading.Event()
        self._decision: str | None = None

    def wait(self, timeout: float = 300) -> str | None:
        self._event.wait(timeout=timeout)
        return self._decision

    def set(self, decision: str) -> None:
        self._decision = decision
        self._event.set()


@app.websocket("/ws/run")
async def ws_run(websocket: WebSocket):
    await websocket.accept()
    try:
        data = await websocket.receive_json()
        project_name = data.get("project_name", "")
        if not project_name:
            raise ValueError("缺少 project_name")
        brief = RoundBrief(**data.get("brief", {}))
        setting = _load_setting(project_name)
    except Exception as e:
        await websocket.send_json({"type": "error", "message": f"请求格式错误：{e}"})
        await websocket.close()
        return

    loop = asyncio.get_event_loop()
    queue: asyncio.Queue = asyncio.Queue()
    retry = RetryDecision()

    def on_step_error(role: str, mode: str, error_msg: str) -> str:
        """从 producer 线程调用：发送错误事件 → 等待会长决策 → 返回 retry/skip。"""
        loop.call_soon_threadsafe(
            queue.put_nowait,
            {"type": "step_error", "role": role, "mode": mode, "error": error_msg},
        )
        decision = retry.wait(timeout=300)
        return decision or "skip"

    def producer():
        try:
            for event in stream_decision(setting, brief, on_step_error=on_step_error):
                loop.call_soon_threadsafe(queue.put_nowait, event)
        except Exception as e:
            loop.call_soon_threadsafe(
                queue.put_nowait, {"type": "error", "message": str(e)}
            )
        finally:
            loop.call_soon_threadsafe(queue.put_nowait, None)

    thread = threading.Thread(target=producer, daemon=True)
    thread.start()

    async def send_events():
        while True:
            event = await queue.get()
            if event is None:
                break
            await websocket.send_json(event)

    async def receive_messages():
        try:
            while True:
                msg = await websocket.receive_json()
                if msg.get("type") == "retry_decision":
                    retry.set(msg.get("action", "skip"))
        except WebSocketDisconnect:
            pass

    try:
        await asyncio.gather(send_events(), receive_messages())
    except WebSocketDisconnect:
        pass
    finally:
        thread.join(timeout=5)


# ── 静态文件（必须最后挂载，否则会拦截 API 请求）────────────────────────────

app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
