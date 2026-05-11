# 🖋️ AI Writer Council / AI 作家委员会

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.10+](https://img.shields.io/badge/python-3.10+-blue.svg)](https://www.python.org/downloads/)
[![Architecture](https://img.shields.io/badge/Architecture-Multi--Agent-red.svg)](#)

> **拒绝平庸的“AI 塑料感”。**
> 本项目通过 5 席具备独立人格的智能体（Agent）组成委员会，模拟真实编辑部的审稿、对线、纠错与润色流程，产出具备细节张力与逻辑深度的小说文本。

---

# 🌟 为什么需要“委员会”？ / Why Council?

单次提示词（Single Prompt）写作往往容易出现：

* 逻辑断层
* 描写平庸
* 人设崩坏
* 虎头蛇尾

因此，我们引入了：

## ⚖️ 权力制衡 / Balance of Power

### 🧠 主编（Editor-in-Chief）

负责把控整体剧情与大纲，拥有一票否决权。
确保故事不跑偏、不失控。

### ✍️ 作家（Writer）

负责初稿创作。
在主编框架内追求极致文采、氛围与意象。

### 🔍 批评家（Critic）

毒舌审稿人。
专门负责挑刺、挖逻辑漏洞、发现角色行为异常。

### 📚 一致性委员（Consistency）

记忆警察。
确保角色的靴子不会在下一章突然变色。

### ✨ 润色师（Polisher）

终审细节。
负责消除 AI 腔、增强语感与节奏。

---

# ✨ 核心特性 / Features

## 🎭 实时辩论流

基于 WebSocket 实现“赛博辩论”实时展示。

看 AI 们为了一个剧情点吵架，
有时候甚至比最终结果更有趣。

## ⚙️ 多模型混编

支持多模型协同工作：

* Claude 
* DeepSeek 
* Gemini
* ....

## 🛡️ 隐私至上

本地优先架构。


## 🚀 零配置启动

内置静态前端。

无需 Node.js。
一行命令即可启动整个创作台。

---

# 🛠️ 快速启动 / Quick Start

## 1️⃣ 克隆项目

```bash
git clone https://github.com/yekongclx-a11y/ai-writer-council.git
cd ai-writer-council
```

---

## 2️⃣ 安装依赖

推荐使用 `uv`：

```bash
uv sync
```

或者使用传统 pip：

```bash
pip install -e .
```

---

## 3️⃣ 配置 API Keys

复制环境变量模板：

```bash
cp .env.example .env
```

随后：

* 在浏览器 `Settings` 页面填写
* 或手动编辑 `.env`

---

## 4️⃣ 启动项目

```bash
./start.sh
```

浏览器访问：

```text
http://127.0.0.1:8000
```

---

# 📂 项目结构 / Project Structure

```text
ai-writer-council/

├── backend/
│
│   ├── main.py
│   │   # FastAPI 入口 / FastAPI entry point
│
│   ├── api/
│   │   ├── routes.py
│   │   │   # HTTP / WebSocket 路由
│   │   │   # API & realtime debate stream routes
│   │   │
│   │   └── deps.py
│   │       # 依赖注入与共享状态
│   │       # Dependency injection & shared states
│   │
│   ├── llm/
│   │   ├── client.py
│   │   │   # 统一 LLM 调用接口
│   │   │   # Unified LLM client abstraction
│   │   │
│   │   ├── providers/
│   │   │   ├── openai.py
│   │   │   ├── anthropic.py
│   │   │   ├── deepseek.py
│   │   │   └── gemini.py
│   │   │   # 多厂商模型适配层
│   │   │   # Provider adapters
│   │   │
│   │   └── config_loader.py
│   │       # 模型配置加载器
│   │       # Model config loader
│   │
│   ├── workflow/
│   │   ├── orchestrator.py
│   │   │   # 委员会总调度器
│   │   │   # Main council orchestrator
│   │   │
│   │   ├── stages/
│   │   │   ├── planning.py
│   │   │   ├── drafting.py
│   │   │   ├── critique.py
│   │   │   ├── consistency_check.py
│   │   │   ├── revision.py
│   │   │   └── polishing.py
│   │   │   # 分阶段写作流水线
│   │   │   # Multi-stage writing pipeline
│   │   │
│   │   ├── memory/
│   │   │   ├── story_state.py
│   │   │   ├── character_state.py
│   │   │   └── timeline.py
│   │   │   # 世界观与角色记忆系统
│   │   │   # Story memory system
│   │   │
│   │   ├── agents/
│   │   │   ├── editor.py
│   │   │   ├── writer.py
│   │   │   ├── critic.py
│   │   │   ├── consistency.py
│   │   │   └── polisher.py
│   │   │   # 各委员会 Agent 实现
│   │   │   # Agent implementations
│   │   │
│   │   └── schemas.py
│   │       # Pydantic 数据模型
│   │       # Shared schemas & DTOs
│   │
│   └── utils/
│       ├── logger.py
│       └── token_counter.py
│       # 日志与 Token 统计工具
│
├── config/
│   ├── committee.yaml
│   │   # 委员配置（角色 / 模型 / 参数）
│   │   # Committee seat configuration
│   │
│   └── models.yaml
│       # 模型提供商配置
│       # Model provider configuration
│
├── presets/
│   ├── default.yaml
│   │   # 默认委员人格 Prompt
│   │
│   ├── dark_fantasy.yaml
│   ├── sci_fi.yaml
│   └── romance.yaml
│   # 不同小说风格预设
│
├── frontend/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── assets/
│       # UI 静态资源
│
├── projects/
│   ├── chronicles/
│   ├── exports/
│   └── autosaves/
│   # 小说项目数据
│
├── .env.example
│   # 环境变量模板
│
├── pyproject.toml
│
└── start.sh
    # 一键启动脚本
```


---

# 🤝 Roadmap / 发展蓝图

* [ ] 场景连播模式（跨章节记忆链）
* [ ] 动态角色档案系统
* [ ] Markdown / PDF / EPUB 导出
* [ ] 世界观时间线自动整理
* [ ] Agent 自主争论强度调节
* [ ] “编辑部深夜模式” UI

---

# 📄 License

本项目采用 MIT License 开源。
