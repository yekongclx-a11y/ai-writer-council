"""
统一 LLM 调用入口。根据委员角色查配置，分发到对应 provider 的调用实现。
"""

import os
from collections import namedtuple

import anthropic
import httpx

from .config_loader import get_committee_config, get_model_config

LLMResult = namedtuple("LLMResult", ["text", "input_tokens", "output_tokens"])


def call_llm(role: str, messages: list[dict], **overrides) -> LLMResult:
    """
    统一 LLM 调用入口。

    Args:
        role:     委员角色 key（如 'writer'），对应 committee.yaml 中的条目
        messages: 对话消息列表，格式 [{"role": "user", "content": "..."}]
        **overrides: 临时覆盖参数，支持 temperature / max_tokens / system_prompt

    Returns:
        LLMResult(text, input_tokens, output_tokens)
    """
    committee = get_committee_config(role)
    provider_key = committee["provider"]
    model = get_model_config(provider_key)

    temperature  = overrides.get("temperature",   committee["temperature"])
    max_tokens   = overrides.get("max_tokens",    committee["max_tokens"])
    system_prompt = overrides.get("system_prompt", committee["system_prompt"])

    if model["api_type"] == "anthropic":
        return _call_anthropic(model, system_prompt, messages, temperature, max_tokens)
    elif model["api_type"] == "openai_compatible":
        return _call_openai_compatible(model, system_prompt, messages, temperature, max_tokens)
    else:
        raise ValueError(f"未知 api_type：'{model['api_type']}'")


def _resolve_base_url(model_config: dict) -> str:
    """从环境变量读取 base_url；未配置则返回 models.yaml 中的官方默认地址。"""
    return (
        os.environ.get(model_config["base_url_env"], "").strip()
        or model_config["default_base_url"]
    )


def _call_anthropic(
    model_config: dict,
    system_prompt: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int,
) -> LLMResult:
    api_key = os.environ.get(model_config["api_key_env"])
    if not api_key:
        raise EnvironmentError(
            f"API key 未配置。请在设置页配置 {model_config['api_key_env']}。"
        )

    base_url = _resolve_base_url(model_config)
    client = anthropic.Anthropic(api_key=api_key, base_url=base_url)

    response = client.messages.create(
        model=model_config["model_name"],
        system=system_prompt,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    text = "".join(b.text for b in response.content if b.type == "text")
    inp = getattr(response.usage, "input_tokens", 0)
    out = getattr(response.usage, "output_tokens", 0)
    return LLMResult(text, inp, out)


def _call_openai_compatible(
    model_config: dict,
    system_prompt: str,
    messages: list[dict],
    temperature: float,
    max_tokens: int,
) -> LLMResult:
    api_key = os.environ.get(model_config["api_key_env"])
    if not api_key:
        raise EnvironmentError(
            f"API key 未配置。请在设置页配置 {model_config['api_key_env']}。"
        )

    base_url = _resolve_base_url(model_config).rstrip("/")
    full_messages = [{"role": "system", "content": system_prompt}] + messages

    response = httpx.post(
        f"{base_url}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model_config["model_name"],
            "messages": full_messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        },
        timeout=120.0,
    )

    if response.status_code != 200:
        raise RuntimeError(
            f"API 请求失败（{model_config['model_name']}）："
            f"HTTP {response.status_code} — {response.text[:300]}"
        )

    body = response.json()
    text = body["choices"][0]["message"]["content"]
    usage = body.get("usage", {})
    inp = usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0)
    out = usage.get("completion_tokens", 0) or usage.get("output_tokens", 0)
    return LLMResult(text, inp, out)
