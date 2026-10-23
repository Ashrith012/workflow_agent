/* eslint-disable @typescript-eslint/no-explicit-any -- node I/O is untyped JSON in Phase 0 */
import { aiExecutors } from './executors-ai.js';
import { appExecutors } from './executors-app.js';
import { interpolate } from './interpolate.js';
import {
  AgentServiceUnreachable,
  isPlainObject,
  mergeOutput,
  postToAgentService,
  shouldRun,
  splitModel,
  type Executor,
} from './node-runtime.js';

export * from './node-runtime.js';

export const DEFAULT_WEBHOOK_PAYLOAD = { body: { text: 'Hello from the webhook' } };

/**
 * Executors keyed by the node `type` strings from src/nodes/registry.ts.
 * `npm run check:registry` verifies the two stay in sync.
 */
export const executors: Record<string, Executor> = {
  WebhookTrigger: async (_input, _params, ctx) =>
    ctx.webhookMock ? ctx.webhookMock.value : DEFAULT_WEBHOOK_PAYLOAD,

  AIAgent: async (input, params, ctx) => {
    const outputField = params.outputField ?? '';
    if (!shouldRun(params.runIf, input, ctx)) return outputField ? mergeOutput(input, outputField, null) : input;

    const prompt = interpolate(params.prompt ?? '', input, ctx.warn);
    const { provider, model } = splitModel(params);
    const tools = (params.tools ?? '').split(',').map((t) => t.trim()).filter(Boolean);
    const memory = params.memory || 'none';
    const responseFormat = params.responseFormat === 'json' ? 'json' : 'text';

    let data: any;
    try {
      // In mock mode the service echoes a mock answer instead of calling the LLM.
      data = await postToAgentService(
        '/agent/execute',
        {
          provider,
          model,
          prompt,
          tools,
          memory,
          live: ctx.live,
          prompt_templates: (params.promptTemplates ?? '').split(',').map((t) => t.trim()).filter(Boolean),
          system_prompt: interpolate(params.systemPrompt ?? '', input, ctx.warn),
          context: interpolate(params.context ?? '', input, ctx.warn),
          history: params.historyField ? readHistory(input, params.historyField) : [],
          response_format: responseFormat,
        },
        ctx,
      );
    } catch (err) {
      if (!(err instanceof AgentServiceUnreachable)) throw err;
      ctx.warn(`${err.message}; falling back to mock.`);
      data = { text: `[mock Python Agent] ${prompt}` };
    }
    if (typeof data?.text !== 'string') {
      throw new Error('Python agent service response missing "text"');
    }
    const result = responseFormat === 'json' ? (data.json ?? null) : data.text;
    if (outputField) return mergeOutput(input, outputField, result);
    return responseFormat === 'json' ? { text: data.text, json: data.json ?? null } : { text: data.text };
  },

  // No mock fallback when the service is down: fake files from a "live" connector would mislead.
  SharePoint: async (input, params, ctx) => {
    const field = (key: string) => interpolate(params[key] ?? '', input, ctx.warn);
    const result = await postToAgentService(
      '/connectors/sharepoint',
      {
        operation: params.operation || 'listFiles',
        site_url: field('siteUrl'),
        library: field('library'),
        path: field('path'),
        list_name: field('listName'),
        content: field('content'),
        live: ctx.live,
      },
      ctx,
    );
    // Blank outputField keeps the original behaviour: the result replaces the input.
    return params.outputField ? mergeOutput(input, params.outputField, result) : result;
  },

  ...aiExecutors,
  ...appExecutors,
};

/** Chat turns at `field` ([{role, content}]); anything else is ignored. */
function readHistory(input: unknown, field: string): { role: string; content: string }[] {
  const value = isPlainObject(input) ? input[field.trim()] : undefined;
  if (!Array.isArray(value)) return [];
  return value
    .filter((t): t is { role: string; content: unknown } => isPlainObject(t) && typeof t.role === 'string')
    .map((t) => ({ role: t.role, content: typeof t.content === 'string' ? t.content : JSON.stringify(t.content) }));
}
