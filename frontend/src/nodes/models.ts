import catalog from '../../../config/models.json';
import type { OptionGroup } from '../types';

/**
 * LLM model catalog for the AI Agent node. The JSON file is shared with the
 * Python agent service, which uses it to route each model to its provider —
 * adding a provider or model there is all it takes to offer it here.
 *
 * Model values are `<provider>:<model id>`, e.g. `groq:openai/gpt-oss-20b`.
 */
export const DEFAULT_MODEL = catalog.default_model;

export const MODEL_GROUPS: OptionGroup[] = Object.entries(catalog.providers).map(([provider, def]) => ({
  label: def.label,
  options: def.models.map((m) => ({ value: `${provider}:${m.id}`, label: m.label })),
}));

/**
 * Rewrites nodes saved before the single AI Agent node existed: the separate
 * OpenAI/Groq nodes, and AIAgent nodes with a `provider` param and a bare model id.
 */
export function migrateLegacyNode(
  type: string | undefined,
  parameters: Record<string, string>,
): { type: string | undefined; parameters: Record<string, string> } {
  const provider = type === 'OpenAI' ? 'openai' : type === 'Groq' ? 'groq' : type === 'AIAgent' ? parameters.provider : undefined;
  if (!provider || parameters.model?.includes(':')) return { type, parameters };

  const { provider: _dropped, ...rest } = parameters;
  const model = parameters.model && !parameters.model.startsWith('llama3-') ? `${provider}:${parameters.model}` : DEFAULT_MODEL;
  return { type: 'AIAgent', parameters: { tools: '', ...rest, model } };
}

/** Embedding models for the Embeddings node, from the same catalog's `embedding_models`. */
export const DEFAULT_EMBEDDING_MODEL = catalog.default_embedding_model;

export const EMBEDDING_MODEL_GROUPS: OptionGroup[] = Object.entries(catalog.embedding_models).map(([provider, models]) => ({
  label: catalog.providers[provider as keyof typeof catalog.providers]?.label ?? provider,
  options: models.map((m) => ({ value: `${provider}:${m.id}`, label: m.label })),
}));
