# Manzil on the workflow builder

The Manzil *Project Execution Validation Assistant* runs entirely as workflows built in the existing builder. Administrators build and publish workflows. End users see only an app with four tabs (Dashboard, Chat with AI, AI Activity, Analytics), and every click or message in it runs a published workflow.

```
End-user app (/app) ──POST /api/app/events/<eventKey>──► API server ──► published workflow (cli/execute.ts)
   renders the returned UI blocks                         auth, role check,       │
                                                          run + chat history      ▼
                                                                         Python agent service
                                                          (LLM, embeddings, Qdrant, SharePoint Graph / MCP, parsing)
```

The frontend and the API server contain no Manzil logic:
- The frontend sends an event key and a payload, then renders what comes back.
- The server authenticates the user, finds the workflow published for that key, runs it and returns the output of its **Respond to UI** node.
- All domain behaviour lives in workflow nodes and in the prompt templates under `config/prompts/`.

## Run it

```bash
npm install
python -m pip install -r requirements.txt     # inside .venv
cp .env.example .env                           # then fill in the values below
npm run dev:all                                # web :5173, API :3001, agent :8000
```

Required in `.env`:

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the first administrator on start, when no users exist |
| `JWT_SECRET` | Signs session cookies (required in production) |
| `DATABASE_URL` | PostgreSQL. Blank uses embedded PGlite in `.data/pglite`, which is for development only |
| `GEMINI_API_KEY` | Embeddings (`gemini-embedding-2`) and the Gemini chat models |
| `GROQ_API_KEY` | The report and dashboard agents (`groq:openai/gpt-oss-120b`); switch them to a Gemini model to need only one key |
| `QDRANT_URL`, `QDRANT_API_KEY` | Vector store |
| `SHAREPOINT_*` | Graph connector (ingestion) |
| `SHAREPOINT_MCP_URL`, `SHAREPOINT_MCP_TOKEN` | SharePoint MCP server |

`APP_RUN_MODE=mock` runs app events without calling models or connectors, which is useful for demos.

## Publish the Manzil workflows

1. Sign in as the administrator and open **Publish & users**.
2. For each template under **Manzil templates**, click **Open in builder**. Check these settings, then test-run it with **Run** (Mock first, then Live):
   - **Qdrant collection** (`project_documents` in the templates). Set it to your collection. The search reads the chunk text from the `text` payload field (or `page_content`) and reads `project_id`, `doc_name`, `url`, `version` and `modified` for filtering and citations.
   - **SharePoint MCP tool name** (`search_documents` in the templates). Click Run with operation `listTools` to see your server's tools.
   - **Models.** The report and dashboard use `groq:openai/gpt-oss-120b` and embeddings use `gemini:gemini-embedding-2`. The embedding model must match the model your Qdrant collection was built with.
3. Publish each workflow, either with **Publish** next to its template or with **Publish canvas** after editing it.
4. Create end users under **Users**.

| Template | Event key | What it does |
| --- | --- | --- |
| `manzil-dashboard-load.json` | `manzil.dashboard.load` | Dashboard home: project picker (Qdrant facet on `project_id`), dashboard toggle, domain buttons |
| `manzil-domain.json` | `manzil.domain` | Domain button → embed → Qdrant search → SharePoint MCP → report agent → optional dashboard agent → UI |
| `manzil-chat.json` | `manzil.chat` | Chat message → domain classifier and dashboard-keyword flag → same pipeline, with chat history |
| `manzil-activity.json` | `manzil.activity` | The user's recent AI requests |
| `manzil-analytics.json` | `manzil.analytics` | Request counts, success rate and latency |
| `manzil-ingest.json` | `manzil.ingest` (admin only) | SharePoint folder → parse PDF/DOCX/XLSX → chunk → embed → upsert into Qdrant |

To ingest a project, open `manzil-ingest.json` in the builder. Set its trigger's sample payload, for example `{"path": "Projects/PRJ-001", "projectId": "PRJ-001"}`, and click **Run** (Live). Scanned PDFs and images are skipped and listed, because there is no OCR.

## How the instructions map onto workflows

| Instruction | Where it lives |
| --- | --- |
| Role, domain rules, validation, citations, response order | `config/prompts/manzil_v2.md` (AI Agent "Prompt templates") |
| Response rendered as tables, project fields one per line | `config/prompts/manzil_ui_output.md`, the JSON block contract the UI renders |
| Dashboard only for the listed keywords | Text Classifier `flags.dashboard` in `manzil-chat.json`; the dashboard toggle on the home page |
| Fixed five-section 16:9 dashboard, footer, colours | `config/prompts/manzil_dashboard.md` (data) + `frontend/src/manzil/ExecutiveDashboard.tsx` (fixed layout, PNG/PDF export) |
| "Never cite documents that were not retrieved" | Respond to UI → *Citation sources field*: citation ids not in the retrieved chunks are removed and flagged |

To change Manzil's behaviour, edit the prompt templates or the workflows in the builder and publish again. No code change is needed.

## New builder nodes

All of these are generic; the Manzil workflows are just one configuration of them.

| Node | Notes |
| --- | --- |
| UI Event Trigger / Chat Trigger | Event key + allowed roles. *Sample payload* is used for builder test runs |
| Text Classifier | Keyword categories and flags; optional LLM fallback |
| Set Fields | JSON template; strings are JSON-escaped, `{{ $json.list }}` embeds JSON |
| Embeddings | Single text, or batch over an items field |
| Qdrant Search / Upsert | Search with a payload filter (blank values ignored) or a facet; upsert creates the collection if missing |
| SharePoint MCP | `callTool` / `listTools` over MCP streamable HTTP |
| SharePoint (new `getFolderFiles` operation) | Every file under a folder, recursively, with contents |
| Document Parser / Text Splitter | Text extraction and chunking with metadata |
| AI Agent (new options) | Prompt templates, context, history, JSON output, *Run only if*, output field |
| Respond to UI | Terminal node; its output is the app's response |
| Run History / Run Stats | Platform data for the AI Activity and Analytics workflows |

Most data nodes have an **Output field** and add their result to the incoming item, so later nodes still see earlier values. *On error: continue* on Qdrant Search and SharePoint MCP lets a run finish when that source is unavailable.

## Tests

```bash
npm run test:agent    # Python tools (mock transports)
npm run test:nodes    # node executors
npm run test:server   # publish + end-user API end to end (needs `npm run dev:agent`)
npm run check:registry
```
