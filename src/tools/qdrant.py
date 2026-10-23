"""Qdrant vector store connector: similarity search, facets and upserts."""
import os
import uuid
from typing import Any, Dict, List, Optional

DEFAULT_TEXT_FIELD = "text"


class QdrantError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code


class QdrantTool:
    """Thin wrapper over AsyncQdrantClient. Tests inject `client`."""

    def __init__(self, url: str = "", api_key: str = "", timeout: float = 60, client: Any = None):
        self.url = url
        self.api_key = api_key
        self.timeout = timeout
        self._client = client

    @classmethod
    def from_env(cls, timeout: float = 60) -> "QdrantTool":
        return cls(url=os.getenv("QDRANT_URL", ""), api_key=os.getenv("QDRANT_API_KEY", ""), timeout=timeout)

    def _get_client(self) -> Any:
        if self._client is None:
            if not self.url:
                raise QdrantError("QDRANT_URL is not set; add it to .env and restart the agent service, or run in mock mode.")
            from qdrant_client import AsyncQdrantClient

            self._client = AsyncQdrantClient(url=self.url, api_key=self.api_key or None, timeout=int(self.timeout))
        return self._client

    async def search(
        self,
        collection: str,
        vector: List[float],
        top_k: int = 8,
        filter: Optional[Dict[str, Any]] = None,
        score_threshold: Optional[float] = None,
        text_field: str = DEFAULT_TEXT_FIELD,
        live: bool = True,
    ) -> Dict[str, Any]:
        if not collection:
            raise QdrantError("search needs a collection name.")
        if not live:
            return {"collection": collection, "chunks": mock_chunks(top_k, filter or {})}
        if not vector:
            raise QdrantError("search needs a query vector; connect an Embeddings node before QdrantSearch.")

        response = await self._get_client().query_points(
            collection_name=collection,
            query=vector,
            limit=top_k,
            query_filter=build_filter(filter or {}),
            score_threshold=score_threshold,
            with_payload=True,
        )
        return {"collection": collection, "chunks": [to_chunk(p.id, p.score, p.payload or {}, text_field) for p in response.points]}

    async def facet(self, collection: str, key: str, limit: int = 100, live: bool = True) -> Dict[str, Any]:
        """Distinct values of a payload field (needs a keyword payload index on `key`)."""
        if not collection or not key:
            raise QdrantError("facet needs a collection and a payload key.")
        if not live:
            return {"collection": collection, "key": key, "values": [{"value": "PRJ-001", "count": 42}, {"value": "PRJ-002", "count": 17}]}
        response = await self._get_client().facet(collection_name=collection, key=key, limit=limit)
        return {"collection": collection, "key": key, "values": [{"value": h.value, "count": h.count} for h in response.hits]}

    async def upsert(
        self,
        collection: str,
        points: List[Dict[str, Any]],
        create_if_missing: bool = True,
        live: bool = True,
    ) -> Dict[str, Any]:
        if not collection:
            raise QdrantError("upsert needs a collection name.")
        for i, point in enumerate(points):
            if not isinstance(point.get("vector"), list) or not point["vector"]:
                raise QdrantError(f"Point {i} has no vector; run an Embeddings node first.")
        if not live:
            return {"collection": collection, "upserted": len(points), "mock": True}
        if not points:
            return {"collection": collection, "upserted": 0}

        from qdrant_client import models

        client = self._get_client()
        if create_if_missing and not await client.collection_exists(collection):
            await client.create_collection(
                collection_name=collection,
                vectors_config=models.VectorParams(size=len(points[0]["vector"]), distance=models.Distance.COSINE),
            )
        await client.upsert(
            collection_name=collection,
            points=[
                models.PointStruct(id=point_id(p), vector=p["vector"], payload=p.get("payload") or {})
                for p in points
            ],
        )
        return {"collection": collection, "upserted": len(points)}


def point_id(point: Dict[str, Any]) -> str:
    """Use the point's id when given; otherwise a stable UUID from its source, so re-ingesting overwrites."""
    if point.get("id"):
        raw = str(point["id"])
        try:
            return str(uuid.UUID(raw))
        except ValueError:
            return str(uuid.uuid5(uuid.NAMESPACE_URL, raw))
    payload = point.get("payload") or {}
    key = f"{payload.get('url') or payload.get('doc_name', '')}#{payload.get('chunk_index', '')}"
    return str(uuid.uuid5(uuid.NAMESPACE_URL, key))


def build_filter(conditions: Dict[str, Any]) -> Any:
    """`{"project_id": "P1", "doc_type": ["LOA", "BOQ"]}` → must-match filter. Blank values are ignored."""
    from qdrant_client import models

    must = []
    for key, value in conditions.items():
        if value is None or value == "" or value == []:
            continue
        if isinstance(value, list):
            must.append(models.FieldCondition(key=key, match=models.MatchAny(any=value)))
        else:
            must.append(models.FieldCondition(key=key, match=models.MatchValue(value=value)))
    return models.Filter(must=must) if must else None


def to_chunk(pid: Any, score: float, payload: Dict[str, Any], text_field: str) -> Dict[str, Any]:
    """Flattens a hit; LangChain-style payloads keep metadata under `metadata` and text under `page_content`."""
    metadata = dict(payload.get("metadata") or {})
    metadata.update({k: v for k, v in payload.items() if k not in ("metadata", text_field, "page_content")})
    text = payload.get(text_field) or payload.get("page_content") or ""
    return {"id": str(pid), "score": round(float(score), 4), "text": text, "metadata": metadata}


def mock_chunks(top_k: int, conditions: Dict[str, Any]) -> List[Dict[str, Any]]:
    project = conditions.get("project_id") or "PRJ-001"
    samples = [
        ("Delivery Challan DC-114.pdf", "Delivery Challan", "CAT6 cable 12 boxes delivered to site on 12-Mar-2026."),
        ("Monthly Progress Report Mar-2026.docx", "Monthly Progress Report", "Desktop computers: 40 approved, 12 rejected in RITES inspection; replacements awaited."),
        ("Call Letter CL-07.pdf", "Call Letter", "Call letter CL-07 issued to RITES for inspection of UPS and LED monitors."),
    ]
    return [
        {
            "id": f"mock-{i}",
            "score": round(0.9 - i * 0.05, 4),
            "text": f"[mock Qdrant] {text}",
            "metadata": {
                "doc_name": name,
                "doc_type": doc_type,
                "project_id": project,
                "url": f"https://contoso.sharepoint.com/sites/mock/Shared Documents/{name}",
                "modified": "2026-03-31T00:00:00Z",
            },
        }
        for i, (name, doc_type, text) in enumerate(samples[: max(top_k, 0)])
    ]
