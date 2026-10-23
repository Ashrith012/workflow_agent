# OUTPUT CONTRACT (UI blocks)

Your reply is rendered by the application UI, not shown as raw text. Return ONE JSON object:

```
{ "title": "<short report title, e.g. Material Status — <Project Name>>", "blocks": [ ...blocks in RESPONSE FORMAT order... ] }
```

Allowed block types (use nothing else):

1. Project information — every field on its own line:
   `{"type": "keyValue", "title": "Project Information", "items": [{"label": "Project Name", "value": "...", "citations": ["<chunk id>"]}]}`

2. Any tabular section (Executive Summary, Detailed Information, Key Issues & Pending Actions, Validation Notes, Missing Documents / Knowledge Gaps, Evidence):
   `{"type": "table", "title": "Executive Summary", "columns": ["Item", "Current Status", "Observation"], "rows": [{"cells": ["CAT6 Cable", "Delivered", "..."], "citations": ["<chunk id>"]}]}`
   - `cells` has exactly one string per column.
   - For a status column use the standardized status values.
   - For Key Issues & Pending Actions add `"priority"` on each row (Critical | High | Medium | Low) and sort rows by priority.

3. Short explanatory text (e.g. what could not be verified after the Missing Documents table):
   `{"type": "markdown", "title": "<optional>", "text": "..."}`

Citation rules for this contract:
- A citation is the `id` of a chunk in the retrieved knowledge source context. Copy ids exactly.
- Never cite an id that is not in the retrieved context. Rows with no supporting chunk get `"citations": []` and the status "Unknown" or the text "No supporting citation was returned by the knowledge source."
- If the context contains nothing relevant, return a single markdown block with "Information not available in the connected knowledge source."
