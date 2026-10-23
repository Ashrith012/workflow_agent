# SFN Agent Workflow Platform

The existing workflow canvas and Python agent service, reorganized under the CTO's
`sfn-agent-code-reviewer/` layout. The folder name follows the supplied convention;
this change does not add code-review capabilities.

## Folder structure

```text
sfn-agent-code-reviewer/
├── config/
│   ├── agent_config.yaml
│   ├── logging.conf
│   └── models.json             # Shared Python/UI model catalog
├── src/
│   ├── __init__.py
│   ├── agent/
│   │   ├── __init__.py
│   │   ├── base.py
│   │   ├── router.py
│   │   └── prompts.py
│   ├── tools/
│   │   ├── __init__.py
│   │   ├── search.py
│   │   ├── database.py
│   │   └── sharepoint.py       # SharePoint Online connector (Microsoft Graph)
│   ├── memory/
│   │   ├── __init__.py
│   │   └── vector_store.py
│   └── main.py                 # FastAPI entry point
├── tests/
│   ├── test_agent.py
│   └── test_tools.py
├── skills/
│   ├── skills.md
│   ├── scripts/
│   └── references/
├── frontend/                  # Existing React canvas
│   ├── src/
│   ├── public/
│   └── index.html
├── server/                    # Existing Fastify workflow API
├── cli/                       # Shared workflow executor and CLI
├── examples/                  # Workflow JSON examples
├── docs/
├── .env.example
├── .gitignore
├── README.md
├── requirements.txt
├── pytest.ini
├── package.json
├── package-lock.json
└── ...                        # Vite, TypeScript, Tailwind and lint configuration
```

The Python folders now sit at the root exactly as requested. The extra frontend,
server and CLI folders retain the existing platform. Node build configuration stays
at the root so npm commands still run there. `skills/` belongs inside the repository.

## Setup

Use Python 3.10+ and a Node version compatible with the versions locked in
`package-lock.json` (Node 24 recommended for this project). Run all commands from
`sfn-agent-code-reviewer/`.

```bash
python -m venv .venv
```

Activate the environment:

```powershell
# Windows PowerShell
.\.venv\Scripts\Activate.ps1
Copy-Item .env.example .env
```

```bash
# macOS / Linux
source .venv/bin/activate
cp .env.example .env
```

Then install dependencies and start the platform:

```bash
python -m pip install -r requirements.txt
npm ci
npm run dev:all
```

- Canvas: http://localhost:5173
- Workflow API: http://localhost:3001
- Python agent API: http://localhost:8000
- Python API docs: http://localhost:8000/docs

Choose **Mock** in the canvas to test without provider keys. For live calls, add
`GROQ_API_KEY` or `OPENAI_API_KEY` to the root `.env`, then restart the services.
The **SharePoint** node needs the `SHAREPOINT_*` values from `.env.example` for live
runs; see [SharePoint node](docs/workflow-canvas.md#sharepoint-node).
The Python service and Node commands use this same root environment file; existing
shell variables take precedence. Keep the virtual environment active when running
`npm run dev:all` so it uses the installed Python dependencies.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev:all` | Start canvas, Fastify API and Python agent |
| `npm run dev` | Canvas only |
| `npm run dev:server` | Fastify API only |
| `npm run dev:agent` | Python agent only |
| `python -m pytest tests/` | Python unit and API tests |
| `npm run build` | Type-check frontend and build into root `dist/` |
| `npm run check:cli` | Type-check CLI |
| `npm run check:server` | Type-check API and shared executor |
| `npm run check:registry` | Compare canvas node registry with executors |
| `npm run run:wf -- examples/simple.json` | Execute a mock workflow |

## What moved

| Previous location | Current location |
| --- | --- |
| `sfn-agent-core/src/` | `src/` |
| `sfn-agent-core/config/` | `config/` |
| `sfn-agent-core/tests/` | `tests/` |
| `sfn-agent-core/skills/` | `skills/` |
| `sfn-agent-core/requirements.txt` | `requirements.txt` |
| `sfn-agent-core/pytest.ini` | `pytest.ini` |
| React `src/`, `public/`, `index.html` | `frontend/` |
| Agent README | `docs/agent-service.md` |
| Original canvas guide | `docs/workflow-canvas.md` |

Imports, model-catalog references, TypeScript includes, Vite paths, Tailwind scanning
and the Python startup command are updated. The health endpoint retains the existing
`service: "sfn-agent-core"` identifier to preserve API compatibility. Two npm test
scripts pointing to absent `e2e/` files were removed; `test:agent` runs the supplied
Python suite.

## Existing implementation limits

This is a structural refactor. `SearchTool` and `DatabaseTool` return mock data
(`SharePointTool` calls Microsoft Graph in live mode);
`InMemoryVectorStore` uses word matching and is not a persistent vector database.
The router is a mock processor; live model calls are handled in `src/main.py`.
`config/logging.conf` is retained but is not automatically loaded by the application.
The existing executor can fall back to mock output when the Python service is
unavailable. These behaviors were not redesigned in this change.

The distributable excludes local secrets, Git internals, installed dependencies and
cache/build output. Copy your existing local credentials into the new root `.env`.
See [agent service](docs/agent-service.md) and [canvas guide](docs/workflow-canvas.md)
for API details and editor usage.
