"""Database query tool (mock implementation)."""
from typing import Any, Dict, List


class DatabaseTool:
    """Mock implementation of a database query tool."""

    def __init__(self, connection_string: str = ""):
        self.connection_string = connection_string

    def query(self, sql: str) -> List[Dict[str, Any]]:
        """Perform a mock database query."""
        return [
            {"id": 1, "query": sql, "status": "executed", "mock_data": "sample row 1"},
            {"id": 2, "query": sql, "status": "executed", "mock_data": "sample row 2"},
        ]
