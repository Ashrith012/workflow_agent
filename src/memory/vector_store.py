"""Vector DB integration (mock in-memory for now)."""
from typing import Any, Dict, List, Optional


class InMemoryVectorStore:
    """Mock in-memory vector store for retrieval-augmented generation (RAG)."""

    def __init__(self):
        self.documents: List[Dict[str, Any]] = []

    def add_document(self, doc_id: str, text: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """Store a document in memory."""
        self.documents.append({
            "id": doc_id,
            "text": text,
            "metadata": metadata or {},
        })

    def search(self, query: str, top_k: int = 3) -> List[Dict[str, Any]]:
        """Mock similarity search returning top documents matching query substrings."""
        words = query.lower().split()
        scored: List[tuple[int, Dict[str, Any]]] = []
        for doc in self.documents:
            text_lower = doc["text"].lower()
            score = sum(1 for w in words if w in text_lower)
            if score > 0:
                scored.append((score, doc))
        scored.sort(key=lambda x: x[0], reverse=True)
        results = [doc for _, doc in scored[:top_k]]
        return results if results else self.documents[:top_k]
