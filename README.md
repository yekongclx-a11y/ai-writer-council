# AI 作家委员会 / AI Writer Council

> 通过多 Agent 委员会协作，产出比单 AI 更有深度的长篇小说。  
> A multi-agent committee that collaborates to write long-form fiction with more depth than a single AI.

---

## 功能简介 / Features

- **5 席委员会**：主编 · 作家 · 批评家 · 一致性委员 · 润色师，各司其职  
  **5-seat committee**: Editor-in-Chief, Writer, Critic, Consistency Officer, Polisher — each with a distinct role
- **实时辩论流**：WebSocket 推送，前端逐步展示委员会讨论过程  
  **Live debate stream**: WebSocket push, front-end renders the committee discussion in real time
- **多厂商支持**：Claude / DeepSeek / Gemini，每位委员可独立配置模型  
  **Multi-provider**: Claude / DeepSeek / Gemini, each committee member configurable independently
- **本地优先**：API Key 仅存于本地 `.env`，不发送给任何第三方  
  **Local-first**: API Keys stored only in local `.env`, never sent to any third party
- **纯静态前端**：无需 Node.js，HTML + CSS + JS 直接由后端托管  
  **Zero-build frontend**: Plain HTML + CSS + JS served directly by the backend

---

## 快速启动 / Quick Start

### 1. 克隆项目 / Clone

```bash
git clone https://github.com/yekongclx-a11y/ai-writer-council.git
cd ai-writer-council
```

### 2. 配置 API Key / Configure API Keys

```bash
cp .env.example .env
# 用文本编辑器打开 .env，填写至少一个 ANTHROPIC_API_KEY
# Open .env and fill in at least ANTHROPIC_API_KEY
```

或者启动后在浏览器设置页填写（推荐）。  
Or fill it in the browser settings page after startup (recommended).

### 3. 安装依赖 / Install dependencies

推荐使用 [uv](https://github.com/astral-sh/uv)：

```bash
uv sync
```

或使用 pip：

```bash
pip install -e .
```

### 4. 启动 / Start

```bash
./start.sh
# 或 / or:
uv run uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

打开浏览器访问 / Open browser: **http://127.0.0.1:8000**

---

## 项目结构 / Project Structure

```
ai-writer-council/
├── backend/
│   ├── main.py              # FastAPI 入口 / FastAPI entry point
│   ├── llm/
│   │   ├── client.py        # 统一 LLM 调用接口 / Unified LLM call interface
│   │   └── config_loader.py # 配置加载器 / Config loader
│   └── workflow/
│       ├── orchestrator.py  # 8 步编排流程 / 8-step orchestration
│       └── schemas.py       # Pydantic 数据模型 / Pydantic models
├── config/
│   ├── committee.yaml       # 委员配置（角色/模型/参数）/ Committee config
│   └── models.yaml          # 模型提供商配置 / Model provider config
├── presets/
│   └── default.yaml         # 各委员 system prompt / Committee system prompts
├── frontend/
│   ├── index.html
│   ├── style.css
│   └── app.js
├── .env.example             # 环境变量模板 / Env template
├── pyproject.toml
└── start.sh
```

---

## 模型配置 / Model Configuration

在 `config/committee.yaml` 中为每位委员指定 `provider`：

```yaml
committees:
  writer:
    provider: claude      # 可选 claude / deepseek / gemini
    temperature: 0.9
    max_tokens: 4000
```

在前端"设置"页为每个 provider 填写 API Key 和（可选的）自定义 Base URL。

---

## 隐私声明 / Privacy

- `.env` 已加入 `.gitignore`，**不会进入 git 版本控制**
- 所有 API Key 只保存在你的本机
- 本项目不收集任何用户数据，不发遥测，不连接作者服务器

---

## License

MIT
