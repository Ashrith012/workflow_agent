"""Skill test script demonstrating tool execution."""
import sys
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from src.tools.search import SearchTool
from src.tools.database import DatabaseTool
from src.memory.vector_store import InMemoryVectorStore


def main():
    print("Testing Web Search Tool...")
    search = SearchTool()
    print(search.search("AI Agent workflows", num_results=2))

    print("\nTesting Database Tool...")
    db = DatabaseTool()
    print(db.query("SELECT * FROM workflows LIMIT 2;"))

    print("\nTesting Vector Store Memory...")
    vs = InMemoryVectorStore()
    vs.add_document("doc1", "FastAPI AI Agent microservice architecture")
    print(vs.search("microservice"))


if __name__ == "__main__":
    main()
