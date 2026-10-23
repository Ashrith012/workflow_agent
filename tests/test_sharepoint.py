"""Tests for the SharePoint connector; Microsoft Graph is faked with httpx.MockTransport."""
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from src.main import app
from src.tools.sharepoint import SharePointError, SharePointTool

client = TestClient(app)

SITE_URL = "https://contoso.sharepoint.com/sites/Marketing"
GRAPH = "https://graph.microsoft.com/v1.0"


def fake_graph(requests):
    """Routes token, site, drive and list calls; records every request in `requests`."""

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        url = str(request.url)
        if url.startswith("https://login.microsoftonline.com/tenant/"):
            return httpx.Response(200, json={"access_token": "tok", "expires_in": 3600})
        if url.startswith("https://download.example/"):
            return httpx.Response(200, content=b"hello world")
        assert request.headers["Authorization"] == "Bearer tok"
        path = request.url.raw_path.decode()
        if path == "/v1.0/sites/contoso.sharepoint.com:/sites/Marketing":
            return httpx.Response(200, json={"id": "site1"})
        if path == "/v1.0/sites/site1/drive/root:/Reports:/children":
            return httpx.Response(
                200,
                json={
                    "value": [{"id": "a", "name": "q1.txt", "size": 3, "file": {}}],
                    "@odata.nextLink": f"{GRAPH}/sites/site1/drive/root:/Reports:/children?page=2",
                },
            )
        if path == "/v1.0/sites/site1/drive/root:/Reports:/children?page=2":
            return httpx.Response(200, json={"value": [{"id": "b", "name": "Archive", "folder": {}}]})
        if path == "/v1.0/sites/site1/drive/root:/Reports/q1%20notes.txt":
            return httpx.Response(
                200,
                json={"id": "c", "name": "q1 notes.txt", "size": 11, "file": {},
                      "@microsoft.graph.downloadUrl": "https://download.example/c"},
            )
        if path == "/v1.0/sites/site1/drive/root:/out.txt:/content" and request.method == "PUT":
            return httpx.Response(201, json={"id": "d", "name": "out.txt", "size": len(request.content), "file": {}})
        if path == "/v1.0/sites/site1/lists/Tasks/items?expand=fields":
            return httpx.Response(200, json={"value": [{"id": "1", "fields": {"Title": "Ship it"}}]})
        return httpx.Response(404, json={"error": {"code": "itemNotFound", "message": "The resource could not be found."}})

    return handler


def make_tool(requests):
    return SharePointTool(
        tenant_id="tenant",
        client_id="client",
        client_secret="secret",
        default_site_url=SITE_URL,
        transport=httpx.MockTransport(fake_graph(requests)),
    )


def test_list_files_follows_pages_and_reuses_token():
    requests = []
    tool = make_tool(requests)
    result = asyncio.run(tool.run("listFiles", path="/Reports/"))
    assert result["folder"] == "/Reports"
    assert [(f["name"], f["isFolder"]) for f in result["files"]] == [("q1.txt", False), ("Archive", True)]

    asyncio.run(tool.run("listFiles", path="Reports"))
    token_calls = [r for r in requests if "login.microsoftonline.com" in str(r.url)]
    site_calls = [r for r in requests if r.url.path.endswith("/sites/Marketing")]
    assert len(token_calls) == 1 and len(site_calls) == 1


def test_list_files_respects_limit():
    result = asyncio.run(make_tool([]).run("listFiles", path="Reports", limit=1))
    assert len(result["files"]) == 1


def test_get_file_downloads_without_graph_token():
    requests = []
    result = asyncio.run(make_tool(requests).run("getFile", path="Reports/q1 notes.txt"))
    assert result["content"] == "hello world"
    assert result["encoding"] == "utf-8"
    download = next(r for r in requests if r.url.host == "download.example")
    assert "Authorization" not in download.headers


def test_upload_file_sends_content():
    requests = []
    result = asyncio.run(make_tool(requests).run("uploadFile", path="out.txt", content="héllo"))
    assert result["size"] == len("héllo".encode("utf-8"))
    assert requests[-1].content == "héllo".encode("utf-8")


def test_list_items_returns_fields():
    result = asyncio.run(make_tool([]).run("listItems", list_name="Tasks"))
    assert result["items"] == [{"id": "1", "webUrl": None, "fields": {"Title": "Ship it"}}]


def test_graph_error_message_is_surfaced():
    with pytest.raises(SharePointError) as exc:
        asyncio.run(make_tool([]).run("getFile", path="missing.txt"))
    assert exc.value.status_code == 502
    assert "itemNotFound" in str(exc.value)


def test_missing_credentials_are_named():
    tool = SharePointTool(default_site_url=SITE_URL)
    with pytest.raises(SharePointError) as exc:
        asyncio.run(tool.run("listFiles"))
    assert "SHAREPOINT_TENANT_ID, SHAREPOINT_CLIENT_ID, SHAREPOINT_CLIENT_SECRET not set" in str(exc.value)


def test_endpoint_mock_mode_needs_no_credentials():
    response = client.post(
        "/connectors/sharepoint",
        json={"operation": "getFile", "path": "Reports/q1.txt", "live": False},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "q1.txt"
    assert body["content"] == "[mock SharePoint] Contents of /Reports/q1.txt"


def test_endpoint_rejects_bad_requests():
    unknown = client.post("/connectors/sharepoint", json={"operation": "deleteSite", "live": False})
    assert unknown.status_code == 400
    assert "Known operations" in unknown.json()["detail"]

    no_path = client.post("/connectors/sharepoint", json={"operation": "getFile", "live": False})
    assert no_path.status_code == 400
    assert "needs a file path" in no_path.json()["detail"]
