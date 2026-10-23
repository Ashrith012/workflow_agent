# Agent Skills & Capabilities

This document outlines the core skills and capability definitions for the Python AI Agent service.

## 1. Web Search (`web_search`)
- **Description**: Allows the agent to query external search engines for current information.
- **Provider**: `src/tools/search.py` (`SearchTool`)
- **Inputs**: `query` (string), `num_results` (integer)
- **Outputs**: List of web search items with title, snippet, and link URL.

## 2. Database Query (`database_query`)
- **Description**: Enables running structured SQL queries against business databases.
- **Provider**: `src/tools/database.py` (`DatabaseTool`)
- **Inputs**: `sql` (string)
- **Outputs**: Rows matching query criteria.

## 3. Vector Memory Retrieval (`vector_memory`)
- **Description**: Semantic memory retrieval from vector store.
- **Provider**: `src/memory/vector_store.py` (`InMemoryVectorStore`)
- **Inputs**: `query` (string), `top_k` (integer)
- **Outputs**: Top relevant documents.
