/** What a published workflow's Respond to UI node returns (see cli/executors-app.ts). */
export interface UiResponse {
  title?: string;
  blocks: Block[];
  sources?: Record<string, Source>;
}

export interface Source {
  doc_name: string;
  url: string;
  doc_type?: string;
  version?: string;
  modified?: string;
}

// Blocks are produced by workflows (often by an LLM), so every field is treated as untrusted and optional.
export type Block = { type: string; title?: string } & Record<string, unknown>;

export interface EventResult {
  runId: string;
  sessionId?: string;
  ui: UiResponse;
}

/** Form values from select/toggle blocks, merged into every button's payload. */
export type FormState = Record<string, string | boolean>;

/** The events the app's tabs fire; a published workflow must exist for each. */
export const EVENTS = {
  dashboard: 'manzil.dashboard.load',
  chat: 'manzil.chat',
  activity: 'manzil.activity',
  analytics: 'manzil.analytics',
} as const;
