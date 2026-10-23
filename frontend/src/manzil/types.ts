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
  /** Version of the published workflow that produced this response. */
  version?: number;
}

/** Form values from select/toggle blocks, merged into every button's payload. */
export type FormState = Record<string, string | boolean>;

/** A published workflow as the app sees it, including the page it asks for in the sidebar. */
export interface PublishedEvent {
  eventKey: string;
  name: string;
  version: number;
  kind: 'chat' | 'event';
  /** Page name in the app; blank means the workflow has no page of its own. */
  section: string;
  /** Sidebar heading, so several agents can live side by side. */
  group: string;
  icon: string;
  /** null when the workflow states no order, so the app's own order stands. */
  order: number | null;
}

/** The events the app's built-in pages fire; a published workflow must exist for each. */
export const EVENTS = {
  overview: 'manzil.overview',
  dashboard: 'manzil.dashboard.load',
  chat: 'manzil.chat',
  activity: 'manzil.activity',
  analytics: 'manzil.analytics',
} as const;
