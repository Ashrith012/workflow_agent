# Workflow Canvas — Phase 1a

A walking-skeleton visual editor for an n8n-style workflow automation platform. Drag nodes onto a canvas, connect them, edit their parameters, export the workflow as JSON, and run it from the browser or the CLI. The HTTP server is stateless: it uses no database, no queue and no auth in this phase.

**Stack:** Vite · React 18 · TypeScript · [@xyflow/react](https://reactflow.dev) (React Flow v12) · zustand · Tailwind CSS v3 · nanoid · lucide-react · Fastify 5 (API)

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173 (editor only)
npm run dev:all  # editor on :5173 + API on :3001 + Python agent service on :8000 — needed for the Run button
npm run build    # type-check (tsc -b) + production build into dist/
npm run preview  # serve the production build
npm run lint     # oxlint
```

## Using the editor

| Action | How |
| --- | --- |
| Add a node | Drag it from the left panel onto the canvas, or click it to drop it at the centre of the view |
| Connect nodes | Drag from a node's right (output) handle to another node's left (input) handle. Self-loops and duplicate edges are rejected |
| Edit parameters | Select a single node; the right-hand Inspector shows its form. Edits apply live |
| Delete | Select nodes or edges and press `Delete` / `Backspace`, or use **Delete node** in the Inspector. Connected edges are removed too |
| Rename | Edit the workflow name in the toolbar |
| Clear | **Clear canvas** (with confirmation) empties the graph and its saved copy |
| Theme | The sun/moon button in the toolbar switches between dark and light. The first visit follows the OS setting. After that, the choice is saved in `localStorage` (`wf-theme`), separately from the graph, so **Clear canvas** doesn't reset it |

The graph is saved to `localStorage` under the key `wf-phase0` after every change and restored on reload.

## Run in the browser

```bash
npm run dev:all   # Vite (web, blue) on :5173 + Fastify (api, green) on :3001 + sfn-agent-core (agent, yellow) on :8000
```

Open http://localhost:5173, build a workflow and click **Run** in the toolbar.

- **Run** serializes the canvas with the same `serializeWorkflow()` call that **Export JSON** uses and sends it to `POST /api/run`. Vite proxies `/api/*` to port 3001, so the browser never makes a cross-origin call.
- The **Mock / Live** switch next to Run picks the mode. It is passed to the Python agent service: Mock returns a mock answer, Live calls the selected model and needs that provider's key (see [AI Agent node and models](#ai-agent-node-and-models)). A missing key fails the AI Agent node with a message naming the variable.
- Run is disabled while the canvas is empty and while a run is in flight.
- The **Run panel** opens under the canvas and shows:
  - a status badge, the mode and the `runId`
  - one row per executed node in execution order, with duration and expandable input/output JSON
  - a failed node as a red row with its error message, with later nodes left out
  - a **Raw result** section with the full response
- If the API isn't running, the panel says so instead of hanging. The client gives up after 35s, which is longer than the server's 30s cap, so the server's "Execution timed out" message wins the race.
- Toggle the panel with the panel button in the toolbar. Run results are never persisted: reloading the page drops them, and an in-flight run is abandoned.

## HTTP API

`server/` is a Fastify app (`npm run dev:server`, port 3001). It runs a workflow synchronously inside the request using the same engine as the CLI (`cli/execute.ts`). It is stateless: there is no database, queue or run history, and restarting it drops in-flight runs.

### `POST /api/run`

Request body:

```json
{
  "workflow": { "version": 1, "name": "…", "nodes": [], "edges": [] },
  "options": { "mode": "mock", "mockPayload": { "body": { "text": "Custom" } } }
}
```

| Field | Meaning |
| --- | --- |
| `workflow` | Required. The export schema, checked by the same validation the CLI uses (`cli/validate.ts`). |
| `options.mode` | `"mock"` (default) or `"live"`. |
| `options.mockPayload` | Optional. What `WebhookTrigger` nodes return, the same as the CLI's `--mock` file. |

Responses:

| Status | Body | When |
| --- | --- | --- |
| 200 | `{ runId, status, nodes, output, durationMs, error? }` | The workflow ran. `status` is `"failed"` if a node threw. That is still a 200, because the run itself happened. |
| 400 | `{ error, details? }` | Malformed body, invalid workflow (`details` lists every schema error), a cycle (`details: { cycle, blocked }`) or an unknown `mode`. |
| 500 | `{ error }` | `"Execution timed out"` after 30s, or an unexpected server error. Stack traces are included only when `NODE_ENV=development`. |

200 response fields:

- `runId`: `run_<nanoid(10)>`.
- `nodes`: one entry per executed node, in topological order: `{ id, type, status: "completed" | "failed", durationMs, input, output, error? }`. Execution stops at the first failed node, so nodes after it are not listed.
- `output`: the outputs of the terminal nodes (nodes with no outgoing edge), keyed by node id. It is `null` on failure.

CORS allows only `http://localhost:5173`, and only when `NODE_ENV` is not `production`. In practice the browser goes through the Vite proxy and CORS never applies.

### CLI vs HTTP on `examples/simple.json`

Both call the same `executeWorkflow()`. Here is the same file run both ways:

```text
$ npm run run:wf -- examples/simple.json
[1/2] WebhookTrigger (node_Xghbgt) ✓ 0ms
    input:  null
    output: { "body": { "text": "Hello from the webhook" } }
[2/2] AIAgent (node_TxCEKL) ✓ 12ms
    input:  { "body": { "text": "Hello from the webhook" } }
    output: { "text": "[mock OpenAI gpt-4o-mini] Processed by Python Agent: Summarize: Hello from the webhook" }

✓ Workflow completed in 14ms
  AIAgent (node_TxCEKL): { "text": "[mock OpenAI gpt-4o-mini] Processed by Python Agent: Summarize: Hello from the webhook" }
```

(The CLI pretty-prints the JSON across several lines; it is condensed here. This is with the Python agent service running; without it the output is `[mock Python Agent] Summarize: …` and a warning goes to stderr.)

```bash
curl -s -X POST localhost:3001/api/run -H 'content-type: application/json' \
  -d "{\"workflow\": $(cat examples/simple.json)}"
```

```json
{
  "runId": "run_wUuszYUGLj",
  "status": "completed",
  "nodes": [
    { "id": "node_Xghbgt", "type": "WebhookTrigger", "status": "completed", "durationMs": 0,
      "input": null, "output": { "body": { "text": "Hello from the webhook" } } },
    { "id": "node_TxCEKL", "type": "AIAgent", "status": "completed", "durationMs": 11,
      "input": { "body": { "text": "Hello from the webhook" } },
      "output": { "text": "[mock OpenAI gpt-4o-mini] Processed by Python Agent: Summarize: Hello from the webhook" } }
  ],
  "output": { "node_TxCEKL": { "text": "[mock OpenAI gpt-4o-mini] Processed by Python Agent: Summarize: Hello from the webhook" } },
  "durationMs": 2
}
```

The node order, statuses, inputs, outputs and the terminal output match. Only the durations differ, and they vary from run to run even within the CLI. The one deliberate difference: a cycle exits 1 in the CLI and returns 400 over HTTP.

## How export works

**Export JSON** runs three steps:

1. **Serialize** (`frontend/src/lib/serialize.ts`): converts React Flow state into the export schema. Each node keeps only `id`, `type`, `position` and `parameters`. `parameters` comes from the node's `data.parameters` and is moved to the top level. Each edge keeps only `id`, `source` and `target`. React Flow internals such as `selected`, `dragging`, `measured` and `markerEnd` are dropped.
2. **Validate** (`frontend/src/lib/validate.ts`):
   - **Errors** (export is blocked and an error banner is shown): the workflow has no nodes, a node has an unknown type, or an edge points at a missing node.
   - **Warnings** (export continues): the graph contains a cycle.
3. **Output:** downloads `workflow.json` and copies the same JSON to the clipboard, then shows an "Exported + copied" confirmation.

Example output:

```json
{
  "version": 1,
  "name": "My Workflow",
  "nodes": [
    { "id": "node_1", "type": "WebhookTrigger", "position": { "x": 0, "y": 0 }, "parameters": { "path": "/v1/test" } },
    { "id": "node_2", "type": "AIAgent", "position": { "x": 320, "y": 0 }, "parameters": { "model": "groq:openai/gpt-oss-20b", "prompt": "Summarize: {{ $json.body.text }}", "tools": "web_search" } }
  ],
  "edges": [{ "id": "edge_1", "source": "node_1", "target": "node_2" }]
}
```

The editor generates IDs as `node_<nanoid(6)>` and `edge_<nanoid(6)>`. Positions are rounded to whole pixels on export.

## Run a workflow from the CLI

`cli/` contains the interpreter for exported workflow files. It runs with [tsx](https://tsx.is) and is not part of the Vite build. The execution core (`cli/execute.ts`) is shared with the HTTP server. `cli/run.ts` only parses flags, loads files and formats the log.

```bash
npm run run:wf -- examples/simple.json                     # mock run
npm run run:wf -- examples/cycle.json                      # exits 1 and lists the cycle's node ids
npm run run:wf -- examples/groq-summary.json --live        # real Groq call via the agent service (needs GROQ_API_KEY)
npm run run:wf -- examples/simple.json --mock payload.json # custom webhook payload
```

| Flag | Meaning |
| --- | --- |
| `--live` | AI Agent nodes ask the Python agent service to call the real model. A missing provider key fails the node. |
| `--mock <file.json>` | `WebhookTrigger` nodes return this file's JSON instead of the default `{ "body": { "text": "Hello from the webhook" } }`. The file must contain valid JSON. |

The scripts load API keys from a git-ignored `.env` file in the project root (copy `.env.example`). Variables already set in your shell take precedence. Restart `dev:server` / `dev:all` after editing `.env`, because tsx watch doesn't reload it.

## AI Agent node and models

There is one LLM node, **AI Agent**. Its **Model** dropdown lists every model from every provider, grouped by provider, and the provider is implied by the model you pick. The node is executed by the Python service in `src/` (see [agent service](agent-service.md)): `cli/executors.ts` POSTs `{ provider, model, prompt, tools, memory, live }` to `AGENT_SERVICE_URL` (default `http://localhost:8000`) `/agent/execute`.

The model list comes from **`config/models.json`**, which both the UI (`frontend/src/nodes/models.ts`) and the Python service read. A node stores the model as `<provider>:<model id>`, e.g. `groq:openai/gpt-oss-20b`.

| Provider | Key | Models |
| --- | --- | --- |
| Groq | `GROQ_API_KEY` | `openai/gpt-oss-20b` (default), `openai/gpt-oss-120b`, `qwen/qwen3.8-27b` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4o-mini`, `gpt-4o` |

**Adding a model or provider** is an edit to `models.json` only. Add a model id under an existing provider, or a new provider entry with `label`, `base_url`, `api_key_env` and `models`; any provider with an OpenAI-compatible chat completions API works (Together, Mistral, OpenRouter, a local Ollama, …). Then restart the agent service and reload the editor.

- **Mock mode** returns `[mock <Provider> <model>] Processed by Python Agent: <resolved prompt>` without calling the LLM.
- **Live mode** needs the provider's key in the root `.env`; restart `dev:agent` after editing it. A missing key or an LLM error fails the node with the provider's message.
- **Service not running:** the node falls back to `[mock Python Agent] <resolved prompt>` and logs a warning, so runs don't break.
- **Older workflows:** canvases saved with the former separate `OpenAI` / `Groq` nodes are converted to AI Agent nodes when the editor loads them. Exported JSON files with those types must be updated by hand (`"type": "AIAgent"`, `"model": "openai:gpt-4o-mini"`).

## SharePoint node

The **SharePoint** node reads from and writes to a SharePoint Online site through Microsoft Graph. Like AI Agent, it is executed by the Python service: `cli/executors.ts` POSTs the node's parameters to `/connectors/sharepoint` (see [agent service](agent-service.md)), and the connector lives in `src/tools/sharepoint.py`.

| Operation | Uses | Output |
| --- | --- | --- |
| `listFiles` | Path = folder (blank for the library root) | `{ folder, files: [{ id, name, isFolder, size, lastModified, webUrl }] }` |
| `getFile` | Path = file, up to 5 MB | the file summary plus `path`, `encoding` and `content`. Text is returned as UTF-8; anything else is base64 with `encoding: "base64"` |
| `uploadFile` | Path = file, Content = text to write (creates or replaces) | the uploaded file's summary plus `path` |
| `listItems` | List name = the list's display name or id | `{ list, items: [{ id, webUrl, fields }] }` |

**Site URL**, **Library**, **Path**, **List name** and **Content** all accept `{{ $json… }}` placeholders. A blank Site URL uses `SHAREPOINT_SITE_URL`. A blank Library uses the site's default document library ("Documents"). Lists return at most 100 files or items. To feed a document into a model, chain SharePoint (`getFile`) → AI Agent with the prompt `Summarize: {{ $json.content }}`.

- **Mock mode** returns sample files, contents and list items in the live shapes, without credentials.
- **Live mode** uses app-only (client credentials) auth. Register an app in Microsoft Entra ID, create a client secret, and grant the Microsoft Graph **application** permission `Sites.Read.All` (`Sites.ReadWrite.All` for `uploadFile`; or `Sites.Selected` scoped to specific sites) with admin consent. Then set `SHAREPOINT_TENANT_ID`, `SHAREPOINT_CLIENT_ID` and `SHAREPOINT_CLIENT_SECRET` in the root `.env` and restart `dev:agent`. Missing values fail the node with a message naming them; Graph errors (for example `itemNotFound` or `accessDenied`) fail the node with Graph's message.
- **Service not running:** unlike AI Agent, the node fails rather than falling back to mock output, so a live run never passes off fake documents as real ones.

How the CLI runs a workflow:

1. **Validate.** The file must match the export schema: `version` is `1`, `nodes` and `edges` are arrays, edges reference existing nodes, and every `node.type` has an executor in `cli/executors.ts`. That last check catches drift between the frontend registry and the CLI. Any problem exits with code 1 and lists every error.
2. **Order.** The CLI runs Kahn's topological sort. If the graph has a cycle, it prints the cycle participants (and any nodes stuck downstream of the cycle) and exits with code 1.
3. **Execute.** Nodes run one at a time in topological order:
   - A root node gets `null` as input.
   - A node with one parent gets that parent's output.
   - A node with several parents gets their outputs shallow-merged in topological order, with a warning (a Phase 0 limitation).
4. **Interpolate.** Prompts can reference the input with `{{ $json.a.b }}` or `{{ $json.items[0].name }}`, and a string can contain several placeholders.
   - Object, array and number values are inserted as JSON.
   - A path that doesn't exist becomes `""` and prints a warning.
   - Placeholders that don't start with `$json` are left as they are.

The step log goes to stdout. Each node prints a line like `[1/2] WebhookTrigger (node_…) ✓ 2ms`, followed by its input and output. Warnings go to stderr. If a node fails, the CLI prints the node id, the error message and the stack, and exits with code 1.

Other commands:

```bash
npm run check:cli       # type-check cli/ (tsc --noEmit -p cli/tsconfig.json)
npm run check:server    # type-check server/ + the cli/ engine under NodeNext resolution
npm run check:registry  # diff the registry node types against the CLI executors; exits 1 if they differ
```

`examples/simple.json`, `examples/cycle.json` and `examples/groq-summary.json` were exported from the running canvas, not written by hand.

**When you add a node type**, also add an executor with the same `type` key in `cli/executors.ts`. Otherwise the CLI and the API reject workflows that use the new type, and `check:registry` reports the mismatch.

Executors receive `(input, parameters, ctx)`. `ctx` is created fresh for each run and carries the mode, the mock payload, a `warn` function and an `AbortSignal`, so concurrent API requests never share state.

Relative imports inside `cli/` use `.js` extensions (`'./graph.js'`), because `server/tsconfig.json` type-checks those files with NodeNext resolution. tsx maps them to the `.ts` files.

## Adding a node type

Edit **only** `frontend/src/nodes/registry.ts` and append an entry to `NODE_DEFINITIONS`:

```ts
import { Globe } from 'lucide-react';

{
  type: 'HttpRequest',            // stored as node.type and exported as "type"
  label: 'HTTP Request',          // palette + node header + inspector title
  accentColor: '#38bdf8',         // header strip, handles, selection ring, minimap
  icon: Globe,                    // any lucide-react icon
  defaultParameters: { method: 'GET', url: '' },
  parameters: [
    { key: 'method', label: 'Method', type: 'select', options: ['GET', 'POST'] },
    { key: 'url', label: 'URL', type: 'text', placeholder: 'https://…' },
  ],
},
```

The new type is picked up automatically in these places:

- **Palette:** `Sidebar.tsx` maps over `NODE_DEFINITIONS`.
- **Canvas renderer:** `components/nodes/nodeTypes.tsx` creates one `BaseNode` wrapper per registry entry. The node card shows the first two parameters as a summary.
- **Inspector form:** `Inspector.tsx` renders `text` as `<input>`, `textarea` as `<textarea>` and `select` as `<select>` (with `<optgroup>`s for `optionGroups`).
- **Export validation:** a node is valid if its type exists in the registry.

## Project layout

```
frontend/src/
  types.ts                    internal node/edge types, registry types, export schema
  nodes/registry.ts           node type definitions (single source of truth)
  nodes/models.ts             AI Agent model picker, read from config/models.json
  store/useWorkflowStore.ts   zustand store + localStorage persistence + connection rules
  store/useThemeStore.ts      dark/light theme, persisted separately (colour tokens live in index.css)
  lib/serialize.ts            internal state → export schema
  lib/validate.ts             export validation
  lib/dnd.ts                  drag-and-drop constants
  api/run.ts                  POST /api/run client (35s timeout, readable errors)
  components/
    Toolbar.tsx               name, counters, run + mode, panel toggle, export, clear
    RunPanel.tsx              bottom sheet with run status, per-node results, raw response
    Sidebar.tsx               draggable / clickable palette
    Canvas.tsx                the single <ReactFlow> instance, drop handling
    Inspector.tsx             registry-driven parameter form
    nodes/BaseNode.tsx        shared node card
    nodes/nodeTypes.tsx       nodeTypes derived from the registry
cli/
  run.ts                      CLI entry: args, load files, format the log
  execute.ts                  executeWorkflow(): sort + node loop → ExecutionResult (no stdout)
  validate.ts                 shape + cycle checks shared by CLI and server
  graph.ts                    schema validation, Kahn's sort, parent lookup
  executors.ts                executor map keyed by registry node types (per-run ctx)
  interpolate.ts              {{ $json.path }} resolution
  log.ts                      warnings (stderr) + payload formatting
  check-registry.ts           registry ↔ executors drift check
server/
  index.ts                    starts Fastify on :3001
  app.ts                      buildServer(): CORS, error handling, routes
  routes/run.ts               POST /api/run
examples/                     real exports from the canvas (simple, cycle, groq-summary)
.env.example                  template for .env (API keys; .env itself is git-ignored)
```

## Notes

- zustand owns the graph state. The app does not use React Flow's `useNodesState` / `useEdgesState`.
- `<ReactFlowProvider>` wraps the whole app, because `Sidebar` calls `useReactFlow()` outside `<ReactFlow>`.
- Drops use `screenToFlowPosition`, not the removed `project()`. A dropped node is centred on the cursor.
- `fitView` runs only when the page loads with a saved graph. On an empty canvas it would re-fit the viewport after the first drop and move the node away from the cursor.
