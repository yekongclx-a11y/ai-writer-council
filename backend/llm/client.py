"""
统一 LLM 调用入口。根据委员角色查配置，分发到对应 provider 的调用实现。
"""

import os
import anthropic

from .config_loader import get_committee_config, get_model_config


def call_llm(role: str, messages: list[dict], **overrides) -> str:
    """
    统一 LLM 调用入口。

    Args:
        role:     委员角色 key（如 'writer'），对应 committee.yaml 中的条目
        messages: 对话消息列表，格式 [{"role": "user", "content": "..."}]
        **overrides: 临时覆盖参数，支持 temperature / max_tokens / system_prompt

    Returns:
        LLM 输出的纯文本字符串
    """
    committee = get_committee_config(role)
    model_key = committee["model"]
    model = get_model_config(model_key)

    # overrides 允许调用方临时覆盖委员默认参数
    temperature = overrides.get("temperature", committee["temperature"])
    max_tokens = overrides.get("max_tokens", committee["max_tokens"])
    system_prompt = overrides.get("system_prompt", committee["system_prompt"])

    # [hook 位] before_call(role, messages) —— 未来中间件/插件链在此介入

    if model["provider"] == "anthropic":
        result = _call_anthropic(model, system_prompt, messages, temperature, max_tokens)
    elif model["provider"] == "openai_compatible":
        result = _call_openai_compatible(model, system_prompt, messages, temperature, max_tokens)
    else:
        raise ValueError(f"未知 provider：'{model['provider']}'")

    # [hook 位] after_call(role, result) —— 未来中间件/插件链在此介入

    return result


def _call_anthropic(
    model_config: dict,
    system_prompt: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int,
) -> str:
    api_key = os.environ.get(model_config["api_key_env"])
    if not api_key:
        raise EnvironmentError(
            f"API key 未配置。请在 .env 文件中设置 {model_config['api_key_env']}。"
        )

    # base_url 留空则 SDK 使用官方默认 endpoint
    base_url = os.environ.get(model_config["base_url_env"]) or None

    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)

    response = client.messages.create(
        model=model_config["model_name"],
        system=system_prompt,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )

    return response.content[0].text


def _call_openai_compatible(
    model_config: dict,
    system_prompt: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int,
) -> str:
    raise NotImplementedError(
        f"openai_compatible provider 尚未实现（model: {model_config['model_name']}）。"
        "DeepSeek / Gemini 调用将在后续阶段通过 httpx 接入。"
    )
