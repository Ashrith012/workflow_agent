"""Abstract base agent class."""
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class BaseAgent(ABC):
    """Abstract base class for all AI agents."""

    def __init__(self, name: str, config: Optional[Dict[str, Any]] = None):
        self.name = name
        self.config = config or {}

    @abstractmethod
    async def run(self, prompt: str, **kwargs: Any) -> Dict[str, Any]:
        """Execute the agent loop with the given prompt."""
        pass
