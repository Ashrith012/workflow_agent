# SFN Agent Core

SFN Agent Core is a dedicated Python microservice handling complex, tool-using AI agents for the Step Function / Workflow platform.

## Architecture

- **FastAPI Entry Point**: `src/main.py` provides high-performance HTTP endpoints for workflow nodes.
- **Agent Router**: `src/agent/router.py` coordinates tool selection and model execution.
- **Tools**: Pluggable modules in `src/tools/` for search, database querying, and external integrations (SharePoint Online in `sharepoint.py`).
- **Memory**: In-memory vector database and retrieval modules in `src/memory/`.
- **Skills**: Modular skill configurations, scripts, and RAG reference materials under `skills/`.

## Running the Service

```bash
# From workspace root:
npm run dev:agent

# Or directly from the project root:
uvicorn src.main:app --reload --port 8000
```

## API Endpoints

- `GET /health`: Health status check.
- `GET /models`: The model catalog, with whether each provider's API key is set.
- `POST /agent/execute`:
  ```json
  {
    "provider": "groq",
    "model": "openai/gpt-oss-20b",
    "prompt": "Summarize user feedback",
    "tools": ["web_search"],
    "memory": "none",
    "live": true
  }
  ```
  `model` may instead be `"selfhosted:qwen2.5:7b"` with no `provider`. `live: false` returns a mock answer without calling the LLM.
  Returns `{ "text": "..." }`. Errors: 400 for an unknown provider or a missing API key, 502 when the LLM call fails.
- `POST /connectors/sharepoint`: runs a SharePoint node (`src/tools/sharepoint.py`) against Microsoft Graph.
  ```json
  {
    "operation": "getFile",
    "site_url": "https://contoso.sharepoint.com/sites/Marketing",
    "library": "",
    "path": "Reports/q1.txt",
    "list_name": "",
    "content": "",
    "limit": 100,
    "live": true
  }
  ```
  `operation` is `listFiles`, `getFile`, `uploadFile` or `listItems`. An empty `site_url` uses `SHAREPOINT_SITE_URL`, and an empty `library` uses the site's default document library. `live: false` returns mock data in the same shape. Errors: 400 for an invalid request or missing `SHAREPOINT_*` credentials, 502 when Azure AD or SharePoint rejects the call (the Graph error code and message are included).

## Models and providers

`config/models.json` lists every provider (`label`, `base_url`, `api_key_env`, `models`) and the default model. The workflow UI's AI Agent node reads the same file for its Model dropdown, so adding a model or an OpenAI-compatible provider there makes it available end to end. No code changes are needed. API keys are read from the project root `.env`.

## Running Tests

```bash
pytest tests/
```
