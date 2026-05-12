"""记忆系统：章节摘要、角色档案、风格指纹的持久化管理。"""

from .manager import load, save, format_context

__all__ = ["load", "save", "format_context"]
