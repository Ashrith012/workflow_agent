/**
 * Per-user data access. Connectors with auth 'user_consent' can be turned off
 * by each end user on My data access; the check runs before every published-
 * workflow run, so turning one off takes effect straight away. Connectors the
 * tenant admin disabled block runs for everyone.
 */
import type { ExportedWorkflow } from '../frontend/src/types.js';
import type { Db } from './db/index.js';

/** Which node types touch which connector. */
const CONNECTOR_NODE_TYPES: Record<string, string[]> = {
  sharepoint: ['SharePoint'],
  'sharepoint-mcp': ['SharePointMCP'],
  qdrant: ['QdrantSearch', 'QdrantUpsert'],
};

/** Which AI Agent tool names touch which connector. */
const CONNECTOR_TOOLS: Record<string, (tool: string) => boolean> = {
  websearch: (t) => t === 'web_search' || t === 'search',
  sharepoint: (t) => t.includes('sharepoint'),
};

/** Connector ids a workflow touches, from its node types and AI Agent tool lists. */
export function connectorsUsedBy(workflow: ExportedWorkflow): string[] {
  const used = new Set<string>();
  const tools = workflow.nodes
    .filter((n) => n.type === 'AIAgent')
    .flatMap((n) => (n.parameters.tools ?? '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean));
  for (const [id, types] of Object.entries(CONNECTOR_NODE_TYPES)) {
    if (workflow.nodes.some((n) => types.includes(n.type))) used.add(id);
  }
  for (const [id, matches] of Object.entries(CONNECTOR_TOOLS)) {
    if (tools.some(matches)) used.add(id);
  }
  return [...used];
}

/**
 * Why this user may not run this workflow right now, or null when they may.
 * Checks the tenant admin's enabled switch and the user's own consent.
 */
export async function connectorProblem(db: Db, userId: string, workflow: ExportedWorkflow): Promise<string | null> {
  const used = connectorsUsedBy(workflow);
  if (used.length === 0) return null;
  const rows = await db.query<{ id: string; name: string; enabled: boolean; auth: string; allowed: boolean | null }>(
    `SELECT c.id, c.name, c.enabled, c.auth, uc.allowed
       FROM connectors c LEFT JOIN user_consents uc ON uc.connector_id = c.id AND uc.user_id = $1
      WHERE c.id = ANY($2)`,
    [userId, used],
  );
  const disabled = rows.find((r) => !r.enabled);
  if (disabled) return `This feature uses ${disabled.name}, which your administrator has turned off.`;
  const denied = rows.find((r) => r.auth === 'user_consent' && r.allowed === false);
  if (denied) return `This feature reads data through ${denied.name}, which you turned off. Allow it again in My data access to use this feature.`;
  return null;
}
