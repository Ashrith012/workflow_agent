"""SharePoint access through an MCP server (streamable HTTP transport)."""
import contextlib
import os
from typing import Any, AsyncIterator, Callable, Dict, List, Optional


class SharePointMCPError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


SessionFactory = Callable[[], "contextlib.AbstractAsyncContextManager[Any]"]


class SharePointMCPTool:
    """Lists and calls the tools of a SharePoint MCP server. Tests inject `session_factory`."""

    def __init__(self, url: str = "", token: str = "", timeout: float = 60, session_factory: Optional[SessionFactory] = None):
        self.url = url
        self.token = token
        self.timeout = timeout
        self._session_factory = session_factory or self._connect

    @classmethod
    def from_env(cls, timeout: float = 60) -> "SharePointMCPTool":
        return cls(url=os.getenv("SHAREPOINT_MCP_URL", ""), token=os.getenv("SHAREPOINT_MCP_TOKEN", ""), timeout=timeout)

    @contextlib.asynccontextmanager
    async def _connect(self) -> AsyncIterator[Any]:
        if not self.url:
            raise SharePointMCPError("SHAREPOINT_MCP_URL is not set; add it to .env and restart the agent service, or run in mock mode.")
        from mcp import ClientSession
        from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

        headers = {"Authorization": f"Bearer {self.token}"} if self.token else None
        try:
            async with create_mcp_http_client(headers=headers) as http_client:
                async with streamable_http_client(self.url, http_client=http_client) as (read, write):
                    async with ClientSession(read, write, read_timeout_seconds=self.timeout) as session:
                        await session.initialize()
                        yield session
        except BaseExceptionGroup as group:
            # anyio task groups wrap transport failures; surface the first real cause.
            raise SharePointMCPError(f"SharePoint MCP server at {self.url}: {_first_leaf(group)}", 502) from group

    async def list_tools(self, live: bool = True) -> Dict[str, Any]:
        if not live:
            return {"tools": MOCK_TOOLS}
        async with self._session_factory() as session:
            result = await session.list_tools()
        return {"tools": [{"name": t.name, "description": t.description or "", "inputSchema": t.inputSchema} for t in result.tools]}

    async def call_tool(self, tool: str, arguments: Optional[Dict[str, Any]] = None, live: bool = True) -> Dict[str, Any]:
        if not tool:
            raise SharePointMCPError("call needs a tool name; list the server's tools with operation 'listTools'.")
        if not live:
            return mock_call(tool, arguments or {})
        async with self._session_factory() as session:
            result = await session.call_tool(tool, arguments or {})
        texts = [block.text for block in result.content if getattr(block, "type", "") == "text"]
        if result.isError:
            raise SharePointMCPError(f"MCP tool '{tool}' failed: {' '.join(texts) or 'no details'}", 502)
        return {"tool": tool, "text": "\n".join(texts), "structured": result.structuredContent}


def _first_leaf(error: BaseException) -> BaseException:
    while isinstance(error, BaseExceptionGroup) and error.exceptions:
        error = error.exceptions[0]
    return error


MOCK_TOOLS: List[Dict[str, Any]] = [
    {"name": "search_documents", "description": "[mock] Full-text search across SharePoint documents", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}},
    {"name": "get_document_metadata", "description": "[mock] Version, author and modified date of a document", "inputSchema": {"type": "object", "properties": {"url": {"type": "string"}}}},
]


def mock_call(tool: str, arguments: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "tool": tool,
        "text": f"[mock SharePoint MCP] {tool} called with {arguments}",
        "structured": {
            "documents": [
                {"name": "Monthly Progress Report Mar-2026.docx", "version": "3.0", "modified": "2026-03-31T00:00:00Z", "approved": True},
                {"name": "Delivery Challan DC-114.pdf", "version": "1.0", "modified": "2026-03-12T00:00:00Z", "approved": True},
            ]
        },
    }
