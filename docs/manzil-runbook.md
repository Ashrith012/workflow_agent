# Manzil runbook: running the workflows

Step-by-step operating notes for the Manzil *Project Execution Validation Assistant*: setting up, ingesting SharePoint documents into Qdrant, publishing the workflows, and using the end-user app. For how the pieces fit together, see [manzil.md](manzil.md).

---

## 1. What runs where

| Process | Port | Started by | Does |
| --- | --- | --- | --- |
| Web app (Vite) | 5173 | `npm run dev` | Builder, Publish & users, end-user app |
| API server (Fastify) | 3001 | `npm run dev:server` | Login, publishing, runs workflows, stores runs and chat history |
| Agent service (FastAPI) | 8000 | `npm run dev:agent` | LLM calls, Gemini embeddings, Qdrant, SharePoint (Graph + MCP), document parsing |

`npm run dev:all` starts all three. Open **http://localhost:5173**.

The six Manzil workflows live in `examples/manzil/`:

| Workflow | Event key | Who triggers it | Purpose |
| --- | --- | --- | --- |
| Ingest SharePoint into Qdrant | `manzil.ingest` | Admin only | Load one project folder's documents into Qdrant |
| Dashboard home | `manzil.dashboard.load` | Opening the Dashboard tab | Project picker + domain buttons |
| Domain report | `manzil.domain` | Clicking a domain button | Material / Sign-Off / Call Letter / … report |
| Chat with AI | `manzil.chat` | Sending a chat message | Free-text questions; dashboard on request |
| AI Activity | `manzil.activity` | Opening the AI Activity tab | The user's recent AI requests |
| Analytics | `manzil.analytics` | Opening the Analytics tab | Counts, success rate, response time |

---

## 2. One-time setup

### 2.1 Install

```powershell
cd D:\sfn-agent-code-reviewer
npm install
.venv\Scripts\activate          # always activate before starting the agent service
python -m pip install -r requirements.txt
```

### 2.2 `.env`

| Variable | Value / where to get it | Needed for |
| --- | --- | --- |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Your choice; creates the first admin on first start | Login |
| `JWT_SECRET` | Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` | Keeps people signed in across restarts (blank = signed out on every restart) |
| `DATABASE_URL` | `postgresql://user:pass@host:5432/db`; blank = embedded PGlite in `.data/pglite` (single machine, dev only) | Users, published workflows, runs, chat |
| `APP_RUN_MODE` | `live` (real calls) or `mock` (demo without any API calls) | End-user app |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | Embeddings (`gemini-embedding-2`) |
| `GROQ_API_KEY` | https://console.groq.com/keys | Report + dashboard agents (`gpt-oss-120b`) and the chat classifier fallback |
| `QDRANT_URL` | Qdrant Cloud → cluster → **Endpoint** (`https://….cloud.qdrant.io`) | Search + ingestion |
| `QDRANT_API_KEY` | Qdrant Cloud → cluster → **API Keys** | Search + ingestion |
| `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID`, `SHAREPOINT_CLIENT_SECRET` | Azure app registration with Graph `Sites.Read.All` (admin-consented) | Ingestion (reads the document library) |
| `SHAREPOINT_SITE_URL` | `https://provigilindia.sharepoint.com/sites/Projects/` | Default site for SharePoint nodes |
| `SHAREPOINT_MCP_URL` | The SharePoint MCP server endpoint (currently Microsoft Agent 365) | Document version/approval metadata in reports |
| `SHAREPOINT_MCP_TOKEN` | Microsoft Entra **bearer token** for that server; currently empty, so this step is skipped (see §8) | Same |

`OPENAI_API_KEY` is not used by the Manzil workflows.

**After any `.env` change, stop `npm run dev:all` (Ctrl+C) and start it again.**

### 2.3 Start

```powershell
.venv\Scripts\activate
npm run dev:all
```

Wait until all three are up: `web` shows `Local: http://localhost:5173/`, `api` shows `Server listening`, `agent` shows `Application startup complete`. Sign in at http://localhost:5173 with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

---

## 3. Flow A: Ingest SharePoint documents into Qdrant (admin)

Run this **before** anything else, once per project folder, and again whenever a project's documents change. It creates the Qdrant collection `project_documents` on the first run.

### What it does

```
UI Event Trigger {path, projectId}
  → SharePoint getFolderFiles   every file under the folder (subfolders included, files up to 25 MB, 6 downloads at a time)
  → Document Parser             PDF / DOCX / XLSX → text
  → Text Splitter               2,500-character chunks, 250 overlap, tagged with project_id
  → Embeddings                  gemini-embedding-2, 3072 dimensions, 100 chunks per call
  → Qdrant Upsert               into project_documents; keyword indexes on project_id and doc_type
  → Respond to UI               summary
```

### The project folders

Library **ProjectExecution**, under **Knowledge Docx - Manzil**:

| Folder (= project id) | Files | Notes |
| --- | --- | --- |
| `Madurai_LC gate` | 57 | 7 scanned PDFs and 2 archives (.rar/.zip) have no extractable text |
| `Hubli` | 55 | 1 PNG (no OCR) |
| `Hubli -SCR` | 44 | 1 zip |
| `Maysor` | 47 | |
| `Nanded` | 69 | |

### Option 1: command line (recommended for whole projects)

Needs the agent service running (`npm run dev:all` or `npm run dev:agent`). It has no time limit and prints one line per step:

```powershell
npm run ingest -- "Madurai_LC gate"
npm run ingest -- "Hubli"
npm run ingest -- "Hubli -SCR"
npm run ingest -- "Maysor"
npm run ingest -- "Nanded"
```

Options: `--project <id>` (default: the folder name), `--library <name>` (default `ProjectExecution`), `--root <path>` (default `Knowledge Docx - Manzil`).

Example output (numbers vary per project):

```
▶ Ingesting ProjectExecution/Knowledge Docx - Manzil/Madurai_LC gate as project "Madurai_LC gate"
✓ UIEventTrigger 0.0s
✓ SharePoint 30s  57 files downloaded
✓ DocumentParser 50s  48 documents with text; no text: Madurai_LOA.pdf (scanned PDF …), …
✓ TextSplitter 0.0s  700 chunks
✓ Embeddings 420s  700 vectors (3072 dimensions)
✓ QdrantUpsert 15s  700 points into "project_documents", indexed: project_id, doc_type
✓ Respond to UI …
✓ Done in 520s
```

### Option 2: from the builder

1. **Publish & users** → *Manzil — Ingest SharePoint into Qdrant* → **Open in builder**.
2. Click the **SharePoint** node → **Library** = `ProjectExecution` (leave Site URL blank to use `SHAREPOINT_SITE_URL`).
3. Click the **UI Event Trigger** node → **Sample payload**:
   ```json
   { "path": "Knowledge Docx - Manzil/Madurai_LC gate", "projectId": "Madurai_LC gate" }
   ```
4. Switch **Mock → Live**, click **Run**, and watch the run panel.

A builder run stops after **10 minutes**. A large project can take longer, because of the embedding pace below. Use the command line for those.

### How long it takes

Gemini's free tier allows **100 embedded chunks per minute**. The agent service waits out each minute automatically (logged as `embedding rate limit; retrying in …s`). About 700 chunks take roughly 7–8 minutes. Running two ingests at the same time doesn't make it faster, because they share the same quota. A paid Gemini tier removes most of the wait.

### Re-running

Chunk ids are derived from the file URL and chunk number, so re-ingesting a project **overwrites** its chunks instead of duplicating them. If a file was deleted in SharePoint, or the chunk size was changed, the old chunks stay. To start clean, delete the collection in Qdrant Cloud (**Cluster UI → Collections**) and ingest every project again.

### What can't be ingested

- **Scanned PDFs and images:** there is no OCR. These files are listed as "no text", so their content is invisible to the assistant, which reports such documents as missing. Examples: `Madurai_LOA.pdf`, some certificates and warranties.
- **.zip / .rar:** archives are skipped; extract them in SharePoint if their contents matter.
- **Files over 25 MB:** skipped and listed.

### Check it worked

Qdrant Cloud → your cluster → **Cluster UI → Collections → `project_documents`**. The point count should go up after each run. Open a point and check that its payload has `text`, `doc_name`, `url`, `project_id`.

---

## 4. Flow B: Test and publish the app workflows (admin)

Nothing is visible to end users until it is published.

### 4.1 Check the settings in each workflow

**Publish & users** → **Open in builder** for each template, then check:

| Node | Setting | Value |
| --- | --- | --- |
| Qdrant Search (dashboard-load, domain, chat) | Collection | `project_documents` |
| Embeddings (domain, chat) | Model | `gemini-embedding-2`. Must be the model used for ingestion |
| SharePoint MCP (domain, chat) | Tool | Your MCP server's search tool (run the node with Operation `listTools` to see the names). The template says `search_documents` |
| AI Agent ×2 (domain, chat) | Model | `GPT-OSS 120B` (Groq), or `Gemini 3.8 Flash` if you prefer one key |

### 4.2 Test-run in the builder

Every trigger has a **Sample payload** that is used when you click **Run**:

| Workflow | Sample payload to try |
| --- | --- |
| Domain report | `{ "domain": "Material Status", "projectId": "Madurai_LC gate", "dashboard": "true" }` |
| Chat | `{ "message": "What is the material status? Include an executive dashboard.", "sessionId": "test", "history": [], "projectId": "Madurai_LC gate" }` |
| Dashboard home | `{}` (the run output's `projects` should list your project ids) |

1. **Run** in **Mock** first. Every node should turn green, with placeholder output.
2. Then switch to **Live** and **Run**. Open the **Respond to UI** row in the run panel; its output is exactly what the end user will see (`title`, `blocks`, `sources`).

A live report run takes about 20–60 seconds (one embedding call, one Qdrant search, and one or two LLM calls).

### 4.3 Publish

- **Publish & users** → **Publish** next to each template, *or*
- after editing in the builder: **Publish & users** → **Publish canvas** (it publishes whatever is currently in the builder).

Publish these five for the app: **Dashboard home, Domain report, Chat with AI, AI Activity, Analytics**. Publishing the ingest workflow is optional; it can only be triggered by admins.

Publishing the same workflow again replaces the live version (the version number goes up). **Unpublish** removes the feature from the app immediately.

### 4.4 Create end users

**Publish & users → Users** → email, password (8+ characters), role **user** → **Add user**.

---

## 5. Flow C: Using the app (end users)

Sign in at http://localhost:5173 with a **user** account. End users land in the app and cannot open the builder.

### Dashboard

1. **Project:** pick a project (from the project ids ingested in Flow A). *All projects* searches across every project.
2. **Include executive dashboard:** tick for the visual one-page summary as well.
3. Click a **domain**: Material Status, Sign-Off Status, Call Letter Status, Inspection Status, Execution Progress, Work Completion or Project Summary.

The report appears below the buttons, in this order: Project Information, Executive Summary, details, Key Issues & Pending Actions, Validation Notes, Missing Documents, Evidence. Each table row has numbered citation chips; click one to open the source document in SharePoint. The **Sources** list at the end names every cited document.

The executive dashboard has **PNG** and **PDF** buttons for download.

### Chat with AI

- Ask in plain language: *"What is the inspection status of the replacement PCs?"*
- The domain is detected from the wording. Add *"executive dashboard"* (or *project dashboard*, *infographic*, *project snapshot* …) to also get the visual dashboard.
- The project chosen on the Dashboard also scopes chat answers (shown at the top of the chat).
- **New chat** starts a fresh conversation; the previous turns of the current chat are used as context.

### AI Activity / Analytics

AI Activity shows the user's own recent AI requests. Analytics shows request counts, success rate and average response time for the last 30 days. Use **Refresh** to reload.

### Admins

Use **End-user app** in the top bar to see exactly what users see. **Publish & users → Recent runs** shows every run from the app, including failures (hover a row for its error).

---

## 6. Daily operation

| Task | How |
| --- | --- |
| Start everything | `.venv\Scripts\activate` then `npm run dev:all` |
| New or changed documents in a project | `npm run ingest -- "<folder>"` |
| New project folder in SharePoint | `npm run ingest -- "<new folder>"`; it appears in the Dashboard's project picker automatically |
| Change the assistant's behaviour or wording | Edit `config/prompts/manzil_v2.md` (rules), `manzil_ui_output.md` (output format) or `manzil_dashboard.md` (dashboard). It takes effect on the next request, with no restart or republish |
| Change a workflow | Open in builder → edit → test-run → Publish canvas |
| Add a user | Publish & users → Users |
| Check a user's failed request | Publish & users → Recent runs (the user sees a "Reference: run_…" id) |

---

## 7. Tests

```powershell
.venv\Scripts\activate
npm run test:agent     # Python connectors (no network)
npm run test:nodes     # workflow node logic
npm run test:server    # publish + end-user API end to end (needs the agent service running)
npm run check:registry # builder palette and engine agree
```

---

## 8. Troubleshooting

| Message | Cause | Fix |
| --- | --- | --- |
| `Unknown embedding model 'gemini:gemini-embedding-2'` | Agent service started before the config change, or an old agent process still on port 8000 | Restart `npm run dev:all`. If it persists: `netstat -ano \| findstr :8000`. Only one `LISTENING` line should remain; end any other PID in Task Manager |
| `Collection 'project_documents' doesn't exist` | Nothing ingested yet | Flow A |
| `429 … embed_content_free_tier_requests` | Gemini free-tier limit (100/minute) | Waited out automatically during ingestion. If it says *PerDay*, wait until tomorrow or upgrade the Gemini tier |
| `GEMINI_API_KEY is not set` (or GROQ/QDRANT) | Missing in `.env`, or not restarted | Fill it in and restart |
| `SharePoint MCP server …: 401` / `…All connection attempts failed`, in the run's `sharepointError` field | No or invalid `SHAREPOINT_MCP_TOKEN`, or wrong URL | Reports still work without it (*On error: continue*), but lack version/approval metadata. Set a valid Entra token for the MCP server |
| `The operation was aborted due to timeout` | A step exceeded its time limit | Ingest from the command line (§3, Option 1); retry the request |
| `Execution timed out` in the builder | Builder runs stop after 10 min | Command-line ingest |
| App: *"This feature is not available yet"* | That workflow isn't published | Flow B, §4.3 |
| App: *"The request could not be completed … Reference: run_…"* | The workflow failed | Admin: Publish & users → Recent runs → hover that run for the error |
| Project picker is empty | Collection missing, or ingested before the `project_id` index existed | Ingest at least one project with the current template (it creates the index) |
| Signed out after every restart | `JWT_SECRET` is blank | Set it (§2.2) |
| Report says *"Information not available in the connected knowledge source"* | Nothing relevant retrieved for that project/domain (e.g. the key document is a scanned PDF) | Check the ingest output's "no text" list; provide text-based versions of key documents |
