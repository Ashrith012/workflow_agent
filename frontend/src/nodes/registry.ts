import {
  BarChart3,
  Binary,
  Bot,
  Braces,
  Database,
  DatabaseZap,
  FileText,
  FolderOpen,
  HeartPulse,
  History,
  LayoutDashboard,
  MessageSquare,
  MousePointerClick,
  Plug,
  Scissors,
  Tags,
  Webhook,
} from 'lucide-react';
import type { NodeDefinition, ParameterDefinition } from '../types';
import { DEFAULT_EMBEDDING_MODEL, DEFAULT_MODEL, EMBEDDING_MODEL_GROUPS, MODEL_GROUPS } from './models';

/** Shared by the data nodes that add their result to the incoming item (see mergeOutput in cli/executors.ts). */
const outputField = (placeholder: string): ParameterDefinition => ({
  key: 'outputField',
  label: 'Output field',
  type: 'text',
  placeholder,
});

/**
 * Single source of truth for node types. The palette, canvas node renderers
 * and inspector form are all derived from this array — adding a node type
 * only requires adding an entry here.
 */
export const NODE_DEFINITIONS: NodeDefinition[] = [
  {
    type: 'WebhookTrigger',
    label: 'Webhook Trigger',
    description: 'Starts the workflow from an HTTP request. Good for testing or for calls from other systems.',
    accentColor: '#22c55e',
    icon: Webhook,
    defaultParameters: { path: '/v1/test' },
    parameters: [{ key: 'path', label: 'Path', type: 'text', placeholder: '/v1/test' }],
  },
  {
    // Started by POST /api/app/events/<eventKey> once the workflow is published.
    type: 'UIEventTrigger',
    label: 'UI Event Trigger',
    description: 'Starts the workflow when a button in the end-user app is clicked. Set the event key and who may use it.',
    accentColor: '#22c55e',
    icon: MousePointerClick,
    defaultParameters: { eventKey: '', allowedRoles: 'user, admin', samplePayload: '{}' },
    parameters: [
      { key: 'eventKey', label: 'Event key', type: 'text', placeholder: 'e.g. manzil.domain' },
      { key: 'allowedRoles', label: 'Allowed roles', type: 'text', placeholder: 'user, admin' },
      { key: 'samplePayload', label: 'Sample payload (test runs)', type: 'textarea', placeholder: '{ "domain": "Material Status" }' },
    ],
  },
  {
    type: 'ChatTrigger',
    label: 'Chat Trigger',
    description: 'Starts the workflow when a user sends a chat message, with the earlier messages included.',
    accentColor: '#22c55e',
    icon: MessageSquare,
    defaultParameters: { eventKey: 'chat.message', allowedRoles: 'user, admin', samplePayload: '' },
    parameters: [
      { key: 'eventKey', label: 'Event key', type: 'text', placeholder: 'chat.message' },
      { key: 'allowedRoles', label: 'Allowed roles', type: 'text', placeholder: 'user, admin' },
      {
        key: 'samplePayload',
        label: 'Sample payload (test runs)',
        type: 'textarea',
        placeholder: '{ "message": "Material Status", "sessionId": "test", "history": [] }',
      },
    ],
  },
  {
    type: 'AIAgent',
    label: 'AI Agent',
    description: 'Asks an AI model (Groq, Gemini or OpenAI) to write an answer from your prompt and the data it is given.',
    accentColor: '#06b6d4',
    icon: Bot,
    defaultParameters: { model: DEFAULT_MODEL, prompt: '', tools: 'web_search' },
    parameters: [
      // Every provider's models in one list; see src/nodes/models.ts.
      { key: 'model', label: 'Model', type: 'select', optionGroups: MODEL_GROUPS },
      {
        key: 'prompt',
        label: 'Prompt',
        type: 'textarea',
        placeholder: 'Reason and answer: {{ $json.body.text }}',
      },
      {
        key: 'tools',
        label: 'Tools',
        type: 'text',
        placeholder: 'web_search',
      },
      { key: 'promptTemplates', label: 'Prompt templates', type: 'text', placeholder: 'config/prompts names, e.g. manzil_v2, manzil_ui_output' },
      { key: 'systemPrompt', label: 'System prompt', type: 'textarea', placeholder: 'Extra instructions (after templates)' },
      { key: 'context', label: 'Context', type: 'textarea', placeholder: '{{ $json.chunks }}' },
      { key: 'historyField', label: 'History field', type: 'text', placeholder: 'history ([{role, content}])' },
      { key: 'responseFormat', label: 'Response format', type: 'select', options: ['text', 'json'] },
      { key: 'maxTokens', label: 'Max output tokens', type: 'text', placeholder: 'blank: provider default' },
      { key: 'maxInputTokens', label: 'Max input tokens', type: 'text', placeholder: 'trims history, then context' },
      { key: 'reasoningEffort', label: 'Reasoning effort', type: 'select', options: ['', 'low', 'medium', 'high'] },
      { key: 'runIf', label: 'Run only if', type: 'text', placeholder: '{{ $json.classification.flags.dashboard }} (blank: always)' },
      outputField('blank: replace the item with {text}'),
    ],
  },
  {
    type: 'TextClassifier',
    label: 'Text Classifier',
    description: 'Sorts a message into a category using keywords, such as which project area a question is about.',
    accentColor: '#a855f7',
    icon: Tags,
    defaultParameters: { text: '{{ $json.message }}', categories: '{}', flags: '{}', defaultCategory: '', model: '', outputField: 'classification' },
    parameters: [
      { key: 'text', label: 'Text', type: 'text', placeholder: '{{ $json.message }}' },
      { key: 'categories', label: 'Categories', type: 'textarea', placeholder: '{ "Material Status": ["material", "delivery"] }' },
      { key: 'flags', label: 'Flags', type: 'textarea', placeholder: '{ "dashboard": ["executive dashboard", "infographic"] }' },
      { key: 'defaultCategory', label: 'Default category', type: 'text', placeholder: 'Used when nothing matches' },
      { key: 'model', label: 'LLM fallback model', type: 'select', options: [''], optionGroups: MODEL_GROUPS },
      outputField('classification'),
    ],
  },
  {
    type: 'SetFields',
    label: 'Set Fields',
    description: 'Creates or reshapes data for the next step, for example by building a search query from earlier values.',
    accentColor: '#64748b',
    icon: Braces,
    defaultParameters: { values: '{}', mode: 'merge' },
    parameters: [
      { key: 'values', label: 'Values (JSON)', type: 'textarea', placeholder: '{ "query": "{{ $json.domain }} for {{ $json.projectId }}" }' },
      { key: 'mode', label: 'Mode', type: 'select', options: ['merge', 'replace'] },
    ],
  },
  {
    type: 'Embeddings',
    label: 'Embeddings',
    description: 'Turns text into numbers that capture its meaning, so similar text can be found later.',
    accentColor: '#f59e0b',
    icon: Binary,
    defaultParameters: { model: DEFAULT_EMBEDDING_MODEL, text: '', itemsField: '', textKey: 'text', outputField: 'vector' },
    parameters: [
      { key: 'model', label: 'Model', type: 'select', optionGroups: EMBEDDING_MODEL_GROUPS },
      { key: 'text', label: 'Text', type: 'textarea', placeholder: 'Single text: {{ $json.query }}' },
      { key: 'itemsField', label: 'Items field', type: 'text', placeholder: 'Batch: e.g. chunks (adds .vector to each)' },
      { key: 'textKey', label: 'Text key (batch)', type: 'text', placeholder: 'text' },
      outputField('vector (single text only)'),
    ],
  },
  {
    type: 'QdrantSearch',
    label: 'Qdrant Search',
    description: 'Finds the document pieces closest in meaning to a question, or lists values such as project IDs.',
    accentColor: '#dc2626',
    icon: Database,
    defaultParameters: { operation: 'search', collection: '', vectorField: 'vector', topK: '8', filter: '', scoreThreshold: '', textField: 'text', facetKey: '', outputField: 'chunks', onError: 'fail' },
    parameters: [
      { key: 'operation', label: 'Operation', type: 'select', options: ['search', 'facet'] },
      { key: 'collection', label: 'Collection', type: 'text', placeholder: 'project_documents' },
      { key: 'vectorField', label: 'Vector field', type: 'text', placeholder: 'vector' },
      { key: 'topK', label: 'Top K / facet limit', type: 'text', placeholder: '8' },
      { key: 'filter', label: 'Filter (JSON)', type: 'textarea', placeholder: '{ "project_id": "{{ $json.projectId }}" } — blank values ignored' },
      { key: 'scoreThreshold', label: 'Score threshold', type: 'text', placeholder: 'e.g. 0.3' },
      { key: 'textField', label: 'Payload text field', type: 'text', placeholder: 'text' },
      { key: 'facetKey', label: 'Facet key', type: 'text', placeholder: 'facet only, e.g. project_id' },
      outputField('chunks (facet: values)'),
      { key: 'onError', label: 'On error', type: 'select', options: ['fail', 'continue'] },
    ],
  },
  {
    type: 'QdrantUpsert',
    label: 'Qdrant Upsert',
    description: 'Saves document pieces and their embeddings into the Qdrant knowledge base so they can be searched.',
    accentColor: '#dc2626',
    icon: DatabaseZap,
    defaultParameters: { collection: '', itemsField: 'chunks', createIfMissing: 'yes', indexFields: 'project_id, doc_type', outputField: 'upsert' },
    parameters: [
      { key: 'collection', label: 'Collection', type: 'text', placeholder: 'project_documents' },
      { key: 'itemsField', label: 'Items field', type: 'text', placeholder: 'chunks (each needs .vector)' },
      { key: 'createIfMissing', label: 'Create collection if missing', type: 'select', options: ['yes', 'no'] },
      { key: 'indexFields', label: 'Index payload fields', type: 'text', placeholder: 'project_id, doc_type (needed for filters and facets)' },
      outputField('upsert'),
    ],
  },
  {
    // Executed by the Python agent service (src/tools/sharepoint.py) via Microsoft Graph.
    type: 'SharePoint',
    label: 'SharePoint',
    description: 'Lists, downloads or uploads files in a SharePoint document library, or reads a SharePoint list.',
    accentColor: '#0ea5e9',
    icon: FolderOpen,
    defaultParameters: { operation: 'listFiles', siteUrl: '', library: '', path: '', listName: '', content: '' },
    parameters: [
      {
        key: 'operation',
        label: 'Operation',
        type: 'select',
        options: ['listFiles', 'getFile', 'getFolderFiles', 'uploadFile', 'listItems'],
      },
      {
        key: 'siteUrl',
        label: 'Site URL',
        type: 'text',
        placeholder: 'https://contoso.sharepoint.com/sites/Team (blank: SHAREPOINT_SITE_URL)',
      },
      { key: 'library', label: 'Library', type: 'text', placeholder: 'Documents (blank: default library)' },
      {
        key: 'path',
        label: 'Path',
        type: 'text',
        placeholder: 'Folder (listFiles, getFolderFiles) or file (getFile / uploadFile)',
      },
      { key: 'listName', label: 'List name', type: 'text', placeholder: 'listItems only, e.g. Tasks' },
      {
        key: 'content',
        label: 'Content',
        type: 'textarea',
        placeholder: 'uploadFile only: {{ $json.text }}',
      },
      outputField('blank: replace the item with the result'),
    ],
  },
  {
    // Executed by the Python agent service (src/tools/sharepoint_mcp.py) over MCP streamable HTTP.
    type: 'SharePointMCP',
    label: 'SharePoint MCP',
    description: 'Calls a tool on a SharePoint MCP server, for example to search live documents.',
    accentColor: '#0ea5e9',
    icon: Plug,
    defaultParameters: { operation: 'callTool', tool: '', arguments: '{}', outputField: 'sharepoint', onError: 'fail' },
    parameters: [
      { key: 'operation', label: 'Operation', type: 'select', options: ['callTool', 'listTools'] },
      { key: 'tool', label: 'Tool', type: 'text', placeholder: 'MCP tool name (run listTools to see them)' },
      { key: 'arguments', label: 'Arguments (JSON)', type: 'textarea', placeholder: '{ "query": "{{ $json.query }}" }' },
      outputField('sharepoint'),
      { key: 'onError', label: 'On error', type: 'select', options: ['fail', 'continue'] },
    ],
  },
  {
    type: 'DocumentParser',
    label: 'Document Parser',
    description: 'Pulls the plain text out of PDF, Word, Excel and text files. Scanned PDFs and images are skipped.',
    accentColor: '#8b5cf6',
    icon: FileText,
    defaultParameters: { itemsField: 'files', outputField: 'documents' },
    parameters: [
      { key: 'itemsField', label: 'Files field', type: 'text', placeholder: 'files (SharePoint getFolderFiles output)' },
      outputField('documents'),
    ],
  },
  {
    type: 'TextSplitter',
    label: 'Text Splitter',
    description: 'Cuts long documents into small, overlapping pieces that are easier to search.',
    accentColor: '#8b5cf6',
    icon: Scissors,
    defaultParameters: { itemsField: 'documents', textKey: 'text', chunkSize: '1500', overlap: '200', metadata: '{}', outputField: 'chunks' },
    parameters: [
      { key: 'itemsField', label: 'Documents field', type: 'text', placeholder: 'documents' },
      { key: 'textKey', label: 'Text key', type: 'text', placeholder: 'text' },
      { key: 'chunkSize', label: 'Chunk size (chars)', type: 'text', placeholder: '1500' },
      { key: 'overlap', label: 'Overlap (chars)', type: 'text', placeholder: '200' },
      { key: 'metadata', label: 'Extra metadata (JSON)', type: 'textarea', placeholder: '{ "project_id": "{{ $json.projectId }}" }' },
      outputField('chunks'),
    ],
  },
  {
    // Terminal node: its output is exactly what the end-user app receives and renders.
    type: 'RespondToUI',
    label: 'Respond to UI',
    description: 'The last step: sends the result back to the app to display, and removes citations with no matching source.',
    accentColor: '#16a34a',
    icon: LayoutDashboard,
    defaultParameters: { title: '', blocksFrom: '', sourcesFrom: '', emptyMessage: '' },
    parameters: [
      { key: 'title', label: 'Title', type: 'text', placeholder: '{{ $json.domain }} (blank: report title)' },
      { key: 'blocksFrom', label: 'Blocks from fields', type: 'text', placeholder: 'dashboard, report' },
      { key: 'sourcesFrom', label: 'Citation sources field', type: 'text', placeholder: 'chunks (validates citation ids)' },
      { key: 'emptyMessage', label: 'Message when empty', type: 'text', placeholder: 'Information not available…' },
    ],
  },
  {
    type: 'RunHistory',
    label: 'Run History',
    description: 'Lists recent workflow runs, for the AI Activity page.',
    accentColor: '#64748b',
    icon: History,
    defaultParameters: { scope: 'mine', limit: '50', title: 'AI Activity', layout: 'table', outputField: 'activity' },
    parameters: [
      { key: 'scope', label: 'Scope', type: 'select', options: ['mine', 'all'] },
      { key: 'limit', label: 'Limit', type: 'text', placeholder: '50' },
      { key: 'title', label: 'Title', type: 'text', placeholder: 'AI Activity' },
      { key: 'layout', label: 'Layout', type: 'select', options: ['table', 'feed'] },
      outputField('activity'),
    ],
  },
  {
    type: 'RunStats',
    label: 'Run Stats',
    description: 'Counts runs, success rate and response time, for the Analytics page.',
    accentColor: '#64748b',
    icon: BarChart3,
    defaultParameters: { scope: 'mine', days: '30', layout: 'full', outputField: 'analytics' },
    parameters: [
      { key: 'scope', label: 'Scope', type: 'select', options: ['mine', 'all'] },
      { key: 'days', label: 'Days', type: 'text', placeholder: '30' },
      { key: 'layout', label: 'Layout', type: 'select', options: ['full', 'kpis'] },
      outputField('analytics'),
    ],
  },
  {
    type: 'PlatformStatus',
    label: 'Platform Status',
    description: 'Shows which workflows are live and whether the AI service and recent runs are healthy.',
    accentColor: '#64748b',
    icon: HeartPulse,
    defaultParameters: { title: 'System status', include: 'workflows', outputField: 'status' },
    parameters: [
      { key: 'include', label: 'Include', type: 'select', options: ['workflows', 'health', 'both'] },
      { key: 'title', label: 'Health card title', type: 'text', placeholder: 'System status' },
      outputField('status'),
    ],
  },
];

const definitionsByType = new Map(NODE_DEFINITIONS.map((def) => [def.type, def]));

export function getNodeDefinition(type: string | undefined): NodeDefinition | undefined {
  return type ? definitionsByType.get(type) : undefined;
}
