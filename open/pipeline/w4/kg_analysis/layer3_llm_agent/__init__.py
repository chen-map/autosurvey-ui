"""
layer3_llm_agent — LLM 驱动的 Skill 执行层

使用 Claude API（tool_use）读取 Layer 2 Skill .md 定义，
自主调用 Layer 1 工具对 KG 执行分析，输出 HTML 小论文格式报告。
"""

from .skill_loader import SkillLoader

__all__ = ["LLMSkillAgent", "SkillLoader"]


def __getattr__(name: str):
    if name == "LLMSkillAgent":
        from .llm_skill_agent import LLMSkillAgent  # lazy — requires anthropic
        return LLMSkillAgent
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
