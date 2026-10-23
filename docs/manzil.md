# Manzil on the workflow builder

The Manzil *Project Execution Validation Assistant* runs as workflows built in the existing builder. Administrators build and publish workflows. End users see an app with five sections (Overview, Reports, Chat with AI, AI Activity, Analytics). Workflow-backed actions and messages run a published workflow.

The end-user app (`/app`) sends `POST /api/app/events/<eventKey>` to the API server. The server authenticates the user, checks their role, records run and chat history, and executes the published workflow through `cli/execute.ts`. Workflow nodes call the Python agent service for LLMs, embeddings, Qdrant, SharePoint Graph / MCP, and parsing. The app renders the returned UI blocks.

- The frontend sends an event key and a payload, then renders what comes back.
- The server authenticates the user, finds the workflow published for that key, runs it, and returns the output of its **Respond to UI** node.
- Domain behaviour is configured in workflow nodes and prompt templates under `config/prompts/`. Frontend components provide the app layout and block rendering.

## Run it

```bash
npm install
python -m pip install -r requirements.txt
```

Run the Python installation command inside your `.venv`.

On first setup only, copy `.env.example` to `.env` and fill in your values. Preserve an existing `.env` to avoid overwriting local credentials.

```powershell
# Windows PowerShell — first setup only
Copy-Item .env.example .env
```

Start the application:

```bash
npm run dev:all
```

Services:

- Frontend: `http://localhost:5173`
- API: `http://localhost:3001`
- Agent service: `http://localhost:8000`

### Environment settings

| Variable | Purpose |
| --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Creates the first administrator on start, when no users exist |
| `JWT_SECRET` | Signs session cookies; required in production |
| `DATABASE_URL` | PostgreSQL connection. Blank uses embedded PGlite in `.data/pglite`, for development only |
| `GEMINI_API_KEY` | Gemini embeddings and chat models; use the embedding model configured in the workflows |
| `GROQ_API_KEY` | Report and dashboard agents using `groq:openai/gpt-oss-120b`; switch them to a Gemini model to use only one model-provider key |
| `QDRANT_URL`, `QDRANT_API_KEY` | Vector store |
| `SHAREPOINT_*` | Graph connector for ingestion |
| `SHAREPOINT_MCP_URL`, `SHAREPOINT_MCP_TOKEN` | SharePoint MCP server |

`APP_RUN_MODE=mock` runs app events without calling models or connectors, which is useful for demos.

## Publish the Manzil workflows

1. Sign in as the administrator and open **Publish & users**.
2. For each template under **Manzil templates**, click **Open in builder**.
3. Check these settings, then test-run the workflow with **Run**, using Mock first and then Live:
   - **Qdrant collection:** The templates use `project_documents`. Set this to your collection. Search reads chunk text from the `text` payload field or `page_content`, and reads `project_id`, `doc_name`, `url`, `version`, and `modified` for filtering and citations.
   - **SharePoint MCP tool name:** The templates use `search_documents`. Run the node with operation `listTools` to see your server's tools.
   - **Models:** The report and dashboard use `groq:openai/gpt-oss-120b`. Check `config/models.json` and the embedding nodes in the ingestion, chat, and domain workflows for the configured embedding model.
4. Publish each workflow with **Publish** next to its template or **Publish canvas** after editing it.
5. Create end users under **Users**.

### Embedding model consistency

Ingestion and search must use the same embedding model and compatible vector dimensions. The embedding configuration must match the model used to create the existing Qdrant vectors.

Inspect model references in Windows PowerShell:

```powershell
Select-String -Path config/models.json,examples/manzil/*.json -Pattern "gemini-embedding"
```

The branch documentation used different embedding model names: `gemini-embedding-001` and `gemini-embedding-2`. Confirm the intended model from the merged configuration and the model used for stored vectors before running live workflows.

Changing this document does not migrate existing vectors. Switching embedding models requires re-embedding documents into a compatible collection.

### Workflow templates

| Template | Event key | What it does |
| --- | --- | --- |
| `manzil-overview.json` | `manzil.overview` | Home page: KPI cards, quick actions, system status and live activity feed. Refreshes every 30 seconds and after each action |
| `manzil-dashboard-load.json` | `manzil.dashboard.load` | Dashboard home: project picker using a Qdrant facet on `project_id`, dashboard toggle and domain buttons |
| `manzil-domain.json` | `manzil.domain` | Domain button → embed → Qdrant search → SharePoint MCP → report agent → optional dashboard agent → UI |
| `manzil-chat.json` | `manzil.chat` | Chat message → domain classifier and dashboard-keyword flag → same pipeline, with chat history |
| `manzil-activity.json` | `manzil.activity` | The user's recent AI requests |
| `manzil-analytics.json` | `manzil.analytics` | Request counts, success rate and latency |
| `manzil-ingest.json` | `manzil.ingest` (admin only) | SharePoint folder → parse PDF/DOCX/XLSX → chunk → embed → upsert into Qdrant |

### Groq token budgets

The documented templates retrieve 4 chunks and configure three AI Agent options:

- **Max input tokens:** The agent service drops the oldest chat turns, then trims context.
- **Max output tokens:** Limits the requested response length.
- **Reasoning effort:** Set to `low`.

When the report and dashboard agents run close together, their combined token use can trigger rate limits. The documented retry behaviour waits for Groq's `retry-after`, up to 30 seconds, and retries once.

Check your account's current limits before raising these values. Limits vary by model and account tier.

## Ingest a project

Open `manzil-ingest.json` in the builder. Set its trigger's sample payload:

```json
{
  "path": "Knowledge Docx - Manzil/Hubli",
  "projectId": "Hubli"
}
```

Click **Run** in Live mode.

The path is a folder inside the SharePoint node's **Library**, `ProjectExecution`. One project folder sits under `Knowledge Docx - Manzil` for each project.

Scanned PDFs and images are skipped and listed because this ingestion flow has no OCR.

## How the instructions map onto workflows

| Instruction | Where it lives |
| --- | --- |
| Role, domain rules, validation, citations and response order | `config/prompts/manzil_v2.md`, selected through AI Agent **Prompt templates** |
| Response rendered as tables, project fields one per line | `config/prompts/manzil_ui_output.md`, the JSON block contract the UI renders |
| Dashboard only for the listed keywords | Text Classifier `flags.dashboard` in `manzil-chat.json`; the dashboard toggle on the home page |
| Fixed five-section 16:9 dashboard, footer and colours | `config/prompts/manzil_dashboard.md` for data and `frontend/src/manzil/ExecutiveDashboard.tsx` for fixed layout and PNG/PDF export |
| Never cite documents that were not retrieved | Respond to UI → **Citation sources field**: citation IDs not in the retrieved chunks are removed and flagged |

### Supported UI blocks

The app renders these blocks:

- `markdown`
- `keyValue`
- `table`
- `kpiCards`
- `barChart`
- `select`
- `toggle`
- `buttonGroup`
- `hero`
- `statusList`
- `activityFeed`

KPI cards accept `icon` and a `trend` array for sparklines.

Buttons accept `icon` and `description`, displayed as action tiles. They can also accept `to: "/app/chat"` to navigate instead of firing an event. Verify that the destination route exists in the merged frontend.

To change configured Manzil behaviour, edit the prompt templates or workflows in the builder and publish again. New UI block types or execution capabilities may require code changes.

## New builder nodes

These nodes are generic. The Manzil workflows are one configuration of them.

| Node | Notes |
| --- | --- |
| UI Event Trigger / Chat Trigger | Event key and allowed roles. **Sample payload** is used for builder test runs |
| Text Classifier | Keyword categories and flags; optional LLM fallback |
| Set Fields | JSON template; strings are JSON-escaped, and `{{ $json.list }}` embeds JSON |
| Embeddings | Single text or batch over an items field |
| Qdrant Search / Upsert | Search with a payload filter, ignoring blank values, or a facet; upsert creates the collection if missing |
| SharePoint MCP | `callTool` / `listTools` over MCP streamable HTTP |
| SharePoint (`getFolderFiles` operation) | Every file under a folder, recursively, with contents |
| Document Parser / Text Splitter | Text extraction and chunking with metadata |
| AI Agent (new options) | Prompt templates, context, history, JSON output, **Run only if** and output field |
| Respond to UI | Terminal node; its output is the app's response |
| Run History / Run Stats | Platform data for the AI Activity, Analytics and Overview workflows. **Layout** `feed` / `kpis` gives the compact Overview versions |
| Platform Status | **Include** `workflows`, the default, returns live workflows the user's role can run. `health` / `both` add a system status card with engine, agent service, runs in progress and 24-hour failures |

Most data nodes have an **Output field** and add their result to the incoming item, so later nodes still see earlier values.

**On error: continue** on Qdrant Search and SharePoint MCP lets a run finish when that source is unavailable.

## Tests

```bash
npm run test:agent
npm run test:nodes
npm run check:registry
```

These check Python tools with mock transports, node executors and registry consistency.

For the publish and end-user API end-to-end tests, start the agent service in a separate terminal:

```bash
npm run dev:agent
```

Then run:

```bash
npm run test:server
```

Finally, start the application and verify both admin and end-user flows:

```bash
npm run dev:all
```