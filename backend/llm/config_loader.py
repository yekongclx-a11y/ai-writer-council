"""
配置加载器：读取 config/committee.yaml、config/models.yaml 和 presets/default.yaml，提供懒加载缓存。
"""

from pathlib import Path
import yaml

# 项目根目录（backend/llm/config_loader.py → 上两级）
_ROOT = Path(__file__).parent.parent.parent
_COMMITTEE_PATH = _ROOT / "config" / "committee.yaml"
_MODELS_PATH = _ROOT / "config" / "models.yaml"
_PRESETS_DIR = _ROOT / "presets"

# 进程内缓存，首次调用时加载，之后不再读盘
_committee: dict | None = None
_models: dict | None = None
_active_preset: dict | None = None  # 当前加载的预设（role → system_prompt）


def _load_configs() -> None:
    global _committee, _models, _active_preset

    for path in (_COMMITTEE_PATH, _MODELS_PATH):
        if not path.exists():
            raise FileNotFoundError(
                f"配置文件缺失：{path}\n"
                f"请确认 config/ 目录已正确创建并包含所需 yaml 文件。"
            )

    with _COMMITTEE_PATH.open(encoding="utf-8") as f:
        _committee = yaml.safe_load(f)["committees"]

    with _MODELS_PATH.open(encoding="utf-8") as f:
        _models = yaml.safe_load(f)["models"]

    # 加载默认预设
    preset_path = _PRESETS_DIR / "default.yaml"
    if not preset_path.exists():
        raise FileNotFoundError(
            f"预设文件缺失：{preset_path}\n"
            f"请确认 presets/ 目录已正确创建并包含 default.yaml。"
        )

    with preset_path.open(encoding="utf-8") as f:
        _active_preset = yaml.safe_load(f)["system_prompts"]

    # 严格校验：committee.yaml 里的每个委员都必须在预设里有对应的 system_prompt
    missing = [role for role in _committee if role not in _active_preset]
    if missing:
        raise ValueError(
            f"预设文件 {preset_path} 缺少以下委员的 system_prompt：{missing}\n"
            f"请在 presets/default.yaml 的 system_prompts 下补充对应条目。"
        )


def get_committee_config(role: str) -> dict:
    """返回指定委员的配置字典（含 system_prompt）。role 为 committee.yaml 中的英文 key（如 'writer'）。"""
    if _committee is None:
        _load_configs()

    if role not in _committee:
        available = ", ".join(_committee.keys())
        raise KeyError(
            f"未知委员角色：'{role}'。"
            f"可用角色：{available}"
        )

    # 浅拷贝后注入 system_prompt，不污染模块级缓存
    config = dict(_committee[role])
    config["system_prompt"] = _active_preset[role]
    # 兼容旧字段名 model → provider
    if "model" in config and "provider" not in config:
        config["provider"] = config.pop("model")
    return config


def get_model_config(model_key: str) -> dict:
    """返回指定模型的配置字典。model_key 为 models.yaml 中的 key（如 'claude'）。"""
    if _models is None:
        _load_configs()

    if model_key not in _models:
        available = ", ".join(_models.keys())
        raise KeyError(
            f"未知模型 key：'{model_key}'。"
            f"可用模型：{available}"
        )

    return _models[model_key]
