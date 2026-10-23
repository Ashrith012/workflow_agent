"""System prompts for AI agents."""

DEFAULT_SYSTEM_PROMPT = """You are an intelligent AI Agent running in the workflow engine.
Answer user requests accurately, concisely, and helpfully.
If tools or context are provided, use them to formulate your response.
"""

AGENT_TOOL_PROMPT = """You have access to the following tools:
{tools}

Use them when necessary to answer user queries.
"""
