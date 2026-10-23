/* eslint-disable @typescript-eslint/no-explicit-any -- node I/O is untyped JSON */
/**
 * Retrieval and document nodes: embeddings, Qdrant, SharePoint MCP, parsing,
 * chunking and classification. Executed through the Python agent service,
 * except TextSplitter and the keyword part of TextClassifier, which are pure.
 */
import {
  BULK_TIMEOUT_MS,
  isPlainObject,
  mergeOutput,
  postToAgentService,
  splitModel,
  type ExecutionContext,
  type Executor,
} from './node-runtime.js';
import { interpolate, interpolateJson, readPath } from './interpolate.js';

/** Texts per embeddings call; matches the agent service's provider batch size. */
const EMBED_BATCH = 100;

/** Array at `path` in the input (a single object counts as one item). */
function readItems(input: unknown, path: string, node: string): any[] {
  const value = readPath(input, path);
  if (Array.isArray(value)) return value;
  if (isPlainObject(value)) return [value];
  throw new Error(`${node}: expected an array at "${path}" in the input, got ${value === undefined ? 'nothing' : typeof value}`);
}

function intParam(value: string | undefined, fallback: number, name: string): number {
  if (!value?.trim()) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw new Error(`"${name}" must be a whole number (got "${value}")`);
  return n;
}

/** Runs `fn` over `items` with at most `limit` in flight, preserving order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Splits text into ~`size`-character chunks with `overlap`, preferring to cut
 * at a paragraph, line or sentence boundary in the last fifth of the window.
 */
export function splitText(text: string, size: number, overlap: number): string[] {
  const clean = text.replace(/\r\n/g, '\n').trim();
  if (!clean) return [];
  if (size <= 0) return [clean];
  const chunks: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + size, clean.length);
    if (end < clean.length) {
      const windowStart = start + Math.floor(size * 0.8);
      const window = clean.slice(windowStart, end);
      const cut = [window.lastIndexOf('\n\n'), window.lastIndexOf('\n'), window.lastIndexOf('. ')].find((i) => i >= 0);
      if (cut !== undefined) end = windowStart + cut + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - overlap, start + 1);
  }
  return chunks;
}

function keywordMap(json: unknown, name: string): Record<string, string[]> {
  if (!isPlainObject(json)) throw new Error(`"${name}" must be a JSON object of name → [keywords]`);
  return Object.fromEntries(
    Object.entries(json).map(([key, words]) => {
      if (!Array.isArray(words) || !words.every((w) => typeof w === 'string')) {
        throw new Error(`"${name}.${key}" must be an array of keyword strings`);
      }
      return [key, words.map((w) => w.toLowerCase())];
    }),
  );
}

async function classifyWithLlm(text: string, categories: string[], params: Record<string, string>, ctx: ExecutionContext) {
  const { provider, model } = splitModel({ model: params.model });
  const data = await postToAgentService(
    '/agent/execute',
    {
      provider,
      model,
      live: ctx.live,
      response_format: 'json',
      system_prompt: `Classify the user's request into exactly one of these categories: ${categories.join(', ')}. Reply as {"category": "<one of the categories, or none>"}.`,
      prompt: text,
    },
    ctx,
  );
  const category = data?.json?.category;
  return typeof category === 'string' && categories.includes(category) ? category : undefined;
}

/**
 * `onError: continue` turns a connector failure into `<outputField>: null` plus
 * `<outputField>Error`, so one unavailable source does not fail the whole run.
 */
function continuable(executor: Executor, defaultField: string): Executor {
  return async (input, params, ctx) => {
    try {
      return await executor(input, params, ctx);
    } catch (err) {
      if (params.onError !== 'continue' || ctx.signal?.aborted) throw err;
      const field = params.outputField || defaultField;
      const message = err instanceof Error ? err.message : String(err);
      ctx.warn(`continuing after error: ${message}`);
      return mergeOutput(mergeOutput(input, field, null), `${field}Error`, message);
    }
  };
}

export const aiExecutors: Record<string, Executor> = {
  TextClassifier: async (input, params, ctx) => {
    const text = interpolate(params.text ?? '', input, ctx.warn);
    const lower = text.toLowerCase();
    const categories = keywordMap(interpolateJson(params.categories ?? '', input, ctx.warn), 'categories');
    const flagWords = keywordMap(interpolateJson(params.flags ?? '', input, ctx.warn), 'flags');

    let best: string | undefined;
    let bestHits = 0;
    for (const [category, words] of Object.entries(categories)) {
      const hits = words.filter((w) => lower.includes(w)).length;
      if (hits > bestHits) [best, bestHits] = [category, hits];
    }
    let method = best ? 'keyword' : 'default';
    if (!best && params.model && Object.keys(categories).length > 0 && ctx.live) {
      best = await classifyWithLlm(text, Object.keys(categories), params, ctx);
      if (best) method = 'llm';
    }
    const flags = Object.fromEntries(Object.entries(flagWords).map(([flag, words]) => [flag, words.some((w) => lower.includes(w))]));
    return mergeOutput(input, params.outputField || 'classification', {
      category: best ?? params.defaultCategory ?? '',
      method,
      flags,
    });
  },

  Embeddings: async (input, params, ctx) => {
    const itemsField = params.itemsField?.trim();
    if (!itemsField) {
      const text = interpolate(params.text ?? '', input, ctx.warn);
      if (!text.trim()) throw new Error('Embeddings: "Text" is empty after interpolation');
      const data = await postToAgentService('/embeddings', { texts: [text], model: params.model ?? '', live: ctx.live }, ctx);
      return mergeOutput(input, params.outputField || 'vector', data.vectors[0]);
    }
    const textKey = params.textKey?.trim() || 'text';
    const items = readItems(input, itemsField, 'Embeddings');
    if (items.length === 0) return mergeOutput(input, itemsField, []);
    const texts = items.map((item) => String(item?.[textKey] ?? ''));
    // One agent-service call per batch, so a rate-limited provider (the service waits and retries)
    // never pushes a single call past its timeout.
    const vectors: number[][] = [];
    for (let start = 0; start < texts.length; start += EMBED_BATCH) {
      const batch = texts.slice(start, start + EMBED_BATCH);
      const data = await postToAgentService('/embeddings', { texts: batch, model: params.model ?? '', live: ctx.live }, ctx, BULK_TIMEOUT_MS);
      vectors.push(...data.vectors);
    }
    return mergeOutput(input, itemsField, items.map((item, i) => ({ ...item, vector: vectors[i] })));
  },

  QdrantSearch: continuable(async (input, params, ctx) => {
    const operation = params.operation || 'search';
    const collection = interpolate(params.collection ?? '', input, ctx.warn);
    const topK = intParam(params.topK, operation === 'facet' ? 100 : 8, 'Top K');
    if (operation === 'facet') {
      const data = await postToAgentService(
        '/connectors/qdrant/search',
        { operation, collection, facet_key: params.facetKey ?? '', top_k: topK, live: ctx.live },
        ctx,
      );
      return mergeOutput(input, params.outputField || 'values', data.values);
    }
    const vector = readPath(input, params.vectorField || 'vector');
    const threshold = params.scoreThreshold?.trim() ? Number(params.scoreThreshold) : null;
    const data = await postToAgentService(
      '/connectors/qdrant/search',
      {
        operation,
        collection,
        vector: Array.isArray(vector) ? vector : [],
        top_k: topK,
        filter: interpolateJson(params.filter ?? '', input, ctx.warn),
        score_threshold: Number.isFinite(threshold) ? threshold : null,
        text_field: params.textField || 'text',
        live: ctx.live,
      },
      ctx,
    );
    return mergeOutput(input, params.outputField || 'chunks', data.chunks);
  }, 'chunks'),

  QdrantUpsert: async (input, params, ctx) => {
    const collection = interpolate(params.collection ?? '', input, ctx.warn);
    const items = readItems(input, params.itemsField || 'chunks', 'QdrantUpsert');
    const points = items.map(({ vector, id, ...payload }) => ({ id, vector, payload }));
    const data = await postToAgentService(
      '/connectors/qdrant/upsert',
      {
        collection,
        points,
        create_if_missing: params.createIfMissing !== 'no',
        index_fields: (params.indexFields ?? '').split(',').map((f) => f.trim()).filter(Boolean),
        live: ctx.live,
      },
      ctx,
      BULK_TIMEOUT_MS,
    );
    return mergeOutput(input, params.outputField || 'upsert', data);
  },

  SharePointMCP: continuable(async (input, params, ctx) => {
    const operation = params.operation || 'callTool';
    const data = await postToAgentService(
      '/connectors/sharepoint-mcp',
      {
        operation,
        tool: interpolate(params.tool ?? '', input, ctx.warn),
        arguments: interpolateJson(params.arguments ?? '', input, ctx.warn),
        live: ctx.live,
      },
      ctx,
    );
    return mergeOutput(input, params.outputField || 'sharepoint', data);
  }, 'sharepoint'),

  DocumentParser: async (input, params, ctx) => {
    const files = readItems(input, params.itemsField || 'files', 'DocumentParser');
    const parsed = await mapLimit(files, 4, async (file) => {
      if (typeof file?.content !== 'string' || typeof file?.name !== 'string') {
        return { name: String(file?.name ?? '?'), skipped: 'no content (use SharePoint getFile / getFolderFiles)' };
      }
      const data = await postToAgentService(
        '/tools/parse',
        { name: file.name, content: file.content, encoding: file.encoding === 'base64' ? 'base64' : 'utf-8' },
        ctx,
        BULK_TIMEOUT_MS, // large PDFs take a while to extract
      );
      const doc = { doc_name: file.name, url: file.webUrl ?? '', path: file.path ?? '', modified: file.lastModified ?? '', text: data.text, pages: data.pages };
      return data.unsupported || !data.text?.trim() ? { name: file.name, skipped: data.unsupported ?? 'no text' } : doc;
    });
    return mergeOutput(
      mergeOutput(input, params.outputField || 'documents', parsed.filter((d: any) => !d.skipped)),
      'skippedDocuments',
      parsed.filter((d: any) => d.skipped),
    );
  },

  TextSplitter: async (input, params, ctx) => {
    const documents = readItems(input, params.itemsField || 'documents', 'TextSplitter');
    const textKey = params.textKey?.trim() || 'text';
    const size = intParam(params.chunkSize, 1500, 'Chunk size');
    const overlap = intParam(params.overlap, 200, 'Overlap');
    const extra = interpolateJson(params.metadata ?? '', input, ctx.warn);
    if (!isPlainObject(extra)) throw new Error('TextSplitter: "Metadata" must be a JSON object');
    const chunks = documents.flatMap((doc) => {
      const { [textKey]: text, ...meta } = isPlainObject(doc) ? doc : { [textKey]: String(doc) };
      return splitText(String(text ?? ''), size, overlap).map((piece, chunk_index) => ({ ...meta, ...extra, chunk_index, text: piece }));
    });
    return mergeOutput(input, params.outputField || 'chunks', chunks);
  },
};
