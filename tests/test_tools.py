"""Unit tests for tools and memory modules."""
from src.tools.search import SearchTool
from src.tools.database import DatabaseTool
from src.memory.vector_store import InMemoryVectorStore


def test_search_tool():
    tool = SearchTool()
    res = tool.search("weather forecast", num_results=2)
    assert res["query"] == "weather forecast"
    assert len(res["results"]) == 2
    assert "url" in res["results"][0]


def test_database_tool():
    db = DatabaseTool()
    rows = db.query("SELECT * FROM agents")
    assert len(rows) == 2
    assert rows[0]["status"] == "executed"


def test_vector_store():
    store = InMemoryVectorStore()
    store.add_document("doc1", "FastAPI microservices in Python", {"category": "backend"})
    store.add_document("doc2", "React Flow workflow diagramming", {"category": "frontend"})

    results = store.search("Python backend")
    assert len(results) > 0
    assert results[0]["id"] == "doc1"
