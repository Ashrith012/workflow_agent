"""Web search tool (mock implementation)."""
from typing import Any, Dict, List


class SearchTool:
    """Mock implementation of a web search tool."""

    def __init__(self, api_key: str = ""):
        self.api_key = api_key

    def search(self, query: str, num_results: int = 3) -> Dict[str, Any]:
        """Perform a mock web search and return structured results."""
        return {
            "query": query,
            "results": [
                {
                    "title": f"Result {i + 1} for '{query}'",
                    "snippet": f"This is mock snippet information about '{query}'.",
                    "url": f"https://example.com/search?q={query}&idx={i + 1}",
                }
                for i in range(num_results)
            ],
        }
