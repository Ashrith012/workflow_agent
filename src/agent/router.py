"""Decides which tool/LLM to call."""
from typing import Any, List, Optional


class AgentRouter:
    """Decides which tool/LLM to call."""

    def __init__(self, config: Optional[dict] = None):
        self.config = config or {}

    def process(self, prompt: str, tools: Optional[List[str]] = None) -> str:
        """Process the prompt and return routed output."""
        return "Processed by Python Agent: " + prompt
