"""SharePoint Online connector over Microsoft Graph (app-only, client credentials)."""
import asyncio
import base64
import os
import time
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlparse

import httpx

GRAPH_URL = "https://graph.microsoft.com/v1.0"
TOKEN_URL = "https://login.microsoftonline.com/{tenant}/oauth2/v2.0/token"
CREDENTIAL_ENV = ("SHAREPOINT_TENANT_ID", "SHAREPOINT_CLIENT_ID", "SHAREPOINT_CLIENT_SECRET")

OPERATIONS = ("listFiles", "getFile", "getFolderFiles", "uploadFile", "listItems")
MAX_DOWNLOAD_BYTES = 25 * 1024 * 1024
DOWNLOAD_CONCURRENCY = 6
DEFAULT_LIMIT = 100


class SharePointError(Exception):
    """A request the connector can't serve. `status_code` is the HTTP status the API should return."""

    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class SharePointTool:
    """Lists, reads and uploads documents and reads list items on a SharePoint Online site."""

    def __init__(
        self,
        tenant_id: str = "",
        client_id: str = "",
        client_secret: str = "",
        default_site_url: str = "",
        timeout: float = 60,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.tenant_id = tenant_id
        self.client_id = client_id
        self.client_secret = client_secret
        self.default_site_url = default_site_url
        self.timeout = timeout
        self._transport = transport  # tests inject httpx.MockTransport
        self._token: Optional[Tuple[str, float]] = None
        self._site_ids: Dict[str, str] = {}

    @classmethod
    def from_env(cls, timeout: float = 60) -> "SharePointTool":
        return cls(
            tenant_id=os.getenv("SHAREPOINT_TENANT_ID", ""),
            client_id=os.getenv("SHAREPOINT_CLIENT_ID", ""),
            client_secret=os.getenv("SHAREPOINT_CLIENT_SECRET", ""),
            default_site_url=os.getenv("SHAREPOINT_SITE_URL", ""),
            timeout=timeout,
        )

    async def run(
        self,
        operation: str,
        site_url: str = "",
        path: str = "",
        library: str = "",
        list_name: str = "",
        content: str = "",
        limit: int = DEFAULT_LIMIT,
        live: bool = True,
    ) -> Dict[str, Any]:
        """Validate the request, then run `operation` against Graph (or return mock data when not live)."""
        if operation not in OPERATIONS:
            raise SharePointError(f"Unknown operation '{operation}'. Known operations: {', '.join(OPERATIONS)}.")
        site_url = (site_url or self.default_site_url).strip()
        path = path.strip().strip("/")
        if operation in ("getFile", "uploadFile") and not path:
            raise SharePointError(f"{operation} needs a file path, e.g. 'Reports/summary.txt'.")
        if operation == "listItems" and not list_name.strip():
            raise SharePointError("listItems needs a list name.")

        if not live:
            return mock_result(operation, site_url, path, list_name.strip(), content)

        if not site_url:
            raise SharePointError("No site URL: set it on the node or SHAREPOINT_SITE_URL in .env.")
        missing = [name for name, value in zip(CREDENTIAL_ENV, (self.tenant_id, self.client_id, self.client_secret)) if not value]
        if missing:
            raise SharePointError(
                f"{', '.join(missing)} not set; add to .env and restart the agent service, or run in mock mode."
            )

        async with httpx.AsyncClient(transport=self._transport, timeout=self.timeout) as client:
            site_id = await self._site_id(client, site_url)
            if operation == "listItems":
                return await self._list_items(client, site_id, list_name.strip(), limit)
            drive = await self._drive_path(client, site_id, library.strip())
            if operation == "listFiles":
                return await self._list_files(client, drive, path, limit)
            if operation == "getFile":
                return await self._get_file(client, drive, path)
            if operation == "getFolderFiles":
                return await self._get_folder_files(client, drive, path, limit)
            return await self._upload_file(client, drive, path, content)

    # ---- Graph plumbing ----

    async def _access_token(self, client: httpx.AsyncClient) -> str:
        if self._token and self._token[1] > time.monotonic():
            return self._token[0]
        response = await client.post(
            TOKEN_URL.format(tenant=self.tenant_id),
            data={
                "grant_type": "client_credentials",
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "scope": "https://graph.microsoft.com/.default",
            },
        )
        if response.status_code != 200:
            raise SharePointError(f"Azure AD token request failed: {_error_message(response)}", 502)
        body = response.json()
        # Refresh a minute early so a token never expires mid-request.
        self._token = (body["access_token"], time.monotonic() + float(body.get("expires_in", 3600)) - 60)
        return self._token[0]

    async def _graph(self, client: httpx.AsyncClient, method: str, url: str, **kwargs: Any) -> Dict[str, Any]:
        token = await self._access_token(client)
        if not url.startswith("https://"):
            url = GRAPH_URL + url
        headers = {"Authorization": f"Bearer {token}", **kwargs.pop("headers", {})}
        response = await client.request(method, url, headers=headers, **kwargs)
        if response.status_code >= 400:
            raise SharePointError(f"SharePoint API error {response.status_code}: {_error_message(response)}", 502)
        return response.json()

    async def _paged(self, client: httpx.AsyncClient, url: str, limit: int) -> List[Dict[str, Any]]:
        values: List[Dict[str, Any]] = []
        next_url: Optional[str] = url
        while next_url and len(values) < limit:
            page = await self._graph(client, "GET", next_url)
            values.extend(page.get("value", []))
            next_url = page.get("@odata.nextLink")
        return values[:limit]

    async def _site_id(self, client: httpx.AsyncClient, site_url: str) -> str:
        if site_url not in self._site_ids:
            parsed = urlparse(site_url if "://" in site_url else f"https://{site_url}")
            if not parsed.hostname:
                raise SharePointError(f"Invalid site URL '{site_url}'.")
            site_path = parsed.path.rstrip("/")
            ref = f"/sites/{parsed.hostname}" + (f":{quote(site_path)}" if site_path else "")
            self._site_ids[site_url] = (await self._graph(client, "GET", ref))["id"]
        return self._site_ids[site_url]

    async def _drive_path(self, client: httpx.AsyncClient, site_id: str, library: str) -> str:
        """Graph path of the document library; the site's default library when `library` is empty."""
        if not library:
            return f"/sites/{site_id}/drive"
        drives = await self._paged(client, f"/sites/{site_id}/drives", limit=1000)
        for drive in drives:
            if drive.get("name", "").lower() == library.lower():
                return f"/drives/{drive['id']}"
        known = ", ".join(d.get("name", "") for d in drives)
        raise SharePointError(f"No document library named '{library}'. Libraries on this site: {known}.")

    # ---- Operations ----

    async def _list_files(self, client: httpx.AsyncClient, drive: str, path: str, limit: int) -> Dict[str, Any]:
        folder = f"{drive}/root:/{quote(path)}:" if path else f"{drive}/root"
        children = await self._paged(client, f"{folder}/children", limit)
        return {"folder": "/" + path, "files": [_file_summary(item) for item in children]}

    async def _get_file(self, client: httpx.AsyncClient, drive: str, path: str) -> Dict[str, Any]:
        item = await self._graph(client, "GET", f"{drive}/root:/{quote(path)}")
        if "file" not in item:
            raise SharePointError(f"'{path}' is a folder, not a file; use listFiles.")
        size = item.get("size", 0)
        if size > MAX_DOWNLOAD_BYTES:
            raise SharePointError(f"'{path}' is {size} bytes; getFile reads files up to {MAX_DOWNLOAD_BYTES} bytes.")
        # The pre-authenticated download URL must not carry the Graph bearer token.
        response = await client.get(item["@microsoft.graph.downloadUrl"], follow_redirects=True)
        if response.status_code >= 400:
            raise SharePointError(f"SharePoint download failed with {response.status_code}.", 502)
        result = {**_file_summary(item), "path": "/" + path}
        try:
            result.update(encoding="utf-8", content=response.content.decode("utf-8"))
        except UnicodeDecodeError:
            result.update(encoding="base64", content=base64.b64encode(response.content).decode("ascii"))
        return result

    async def _get_folder_files(self, client: httpx.AsyncClient, drive: str, path: str, limit: int) -> Dict[str, Any]:
        """Every file under `path`, subfolders included, with contents (for ingestion). Stops at `limit` files."""
        wanted: List[str] = []
        skipped: List[Dict[str, Any]] = []
        folders = [path]
        while folders and len(wanted) < limit:
            folder = folders.pop(0)
            listing = await self._list_files(client, drive, folder, 1000)
            for entry in listing["files"]:
                child = f"{folder}/{entry['name']}" if folder else entry["name"]
                if entry["isFolder"]:
                    folders.append(child)
                elif len(wanted) >= limit:
                    break
                elif (entry.get("size") or 0) > MAX_DOWNLOAD_BYTES:
                    skipped.append({"name": entry["name"], "path": "/" + child, "reason": f"larger than {MAX_DOWNLOAD_BYTES} bytes"})
                else:
                    wanted.append(child)

        # Download a few at a time; one file failing is reported, not fatal.
        semaphore = asyncio.Semaphore(DOWNLOAD_CONCURRENCY)

        async def fetch(child: str) -> Any:
            async with semaphore:
                try:
                    return await self._get_file(client, drive, child)
                except (SharePointError, httpx.HTTPError) as err:
                    return {"name": child.rsplit("/", 1)[-1], "path": "/" + child, "reason": str(err)}

        files: List[Dict[str, Any]] = []
        for result in await asyncio.gather(*(fetch(c) for c in wanted)):
            (files if "content" in result else skipped).append(result)
        return {"folder": "/" + path, "files": files, "skipped": skipped}

    async def _upload_file(self, client: httpx.AsyncClient, drive: str, path: str, content: str) -> Dict[str, Any]:
        item = await self._graph(
            client,
            "PUT",
            f"{drive}/root:/{quote(path)}:/content",
            content=content.encode("utf-8"),
            headers={"Content-Type": "text/plain; charset=utf-8"},
        )
        return {**_file_summary(item), "path": "/" + path}

    async def _list_items(self, client: httpx.AsyncClient, site_id: str, list_name: str, limit: int) -> Dict[str, Any]:
        # Graph accepts a list's display name in place of its id.
        items = await self._paged(client, f"/sites/{site_id}/lists/{quote(list_name, safe='')}/items?expand=fields", limit)
        return {
            "list": list_name,
            "items": [{"id": i.get("id"), "webUrl": i.get("webUrl"), "fields": i.get("fields", {})} for i in items],
        }


def _file_summary(item: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item.get("id"),
        "name": item.get("name"),
        "isFolder": "folder" in item,
        "size": item.get("size"),
        "lastModified": item.get("lastModifiedDateTime"),
        "webUrl": item.get("webUrl"),
    }


def _error_message(response: httpx.Response) -> str:
    """Graph and Azure AD error bodies carry the useful text in different fields."""
    try:
        body = response.json()
    except ValueError:
        return response.text or response.reason_phrase
    error = body.get("error")
    if isinstance(error, dict):
        return f"{error.get('code', '')}: {error.get('message', '')}".strip(": ")
    return body.get("error_description") or str(error or body)


def mock_result(operation: str, site_url: str, path: str, list_name: str, content: str) -> Dict[str, Any]:
    """Same shapes as live results, so downstream nodes can be built without credentials."""
    site = (site_url or "https://contoso.sharepoint.com/sites/mock").rstrip("/")

    def file(full: str, folder: bool = False) -> Dict[str, Any]:
        return {
            "id": f"mock-{full}",
            "name": full.rsplit("/", 1)[-1],
            "isFolder": folder,
            "size": 0 if folder else 1024,
            "lastModified": "2026-01-01T00:00:00Z",
            "webUrl": f"{site}/Shared Documents/{full}",
        }

    if operation == "listFiles":
        prefix = f"{path}/" if path else ""
        names = [("Reports", True), ("notes.txt", False), ("budget.xlsx", False)]
        return {"folder": "/" + path, "files": [file(prefix + name, folder) for name, folder in names]}
    if operation == "getFile":
        return {**file(path), "path": "/" + path, "encoding": "utf-8", "content": f"[mock SharePoint] Contents of /{path}"}
    if operation == "getFolderFiles":
        prefix = f"{path}/" if path else ""
        names = ["Delivery Challan DC-114.txt", "Monthly Progress Report Mar-2026.txt"]
        return {
            "folder": "/" + path,
            "files": [
                {**file(prefix + n), "path": "/" + prefix + n, "encoding": "utf-8", "content": f"[mock SharePoint] Contents of {n}"}
                for n in names
            ],
            "skipped": [],
        }
    if operation == "uploadFile":
        return {**file(path), "path": "/" + path, "size": len(content.encode("utf-8"))}
    return {
        "list": list_name,
        "items": [
            {"id": str(i), "webUrl": f"{site}/Lists/{list_name}/DispForm.aspx?ID={i}", "fields": {"Title": f"Mock item {i}"}}
            for i in (1, 2)
        ],
    }
