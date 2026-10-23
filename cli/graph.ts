import type { ExportedEdge, ExportedNode, ExportedWorkflow } from '../frontend/src/types.js';

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Structural validation of an exported workflow (the shape produced by
 * src/lib/serialize.ts). Returns every problem found, not just the first.
 * `knownTypes` is the executor map's key set — an unknown type means the
 * frontend registry and the CLI have drifted.
 */
export function validateWorkflowFile(data: unknown, knownTypes: Set<string>): string[] {
  if (!isObject(data)) return ['Top level must be a JSON object.'];

  const errors: string[] = [];
  if (data.version !== 1) errors.push(`Unsupported version ${JSON.stringify(data.version)} (expected 1).`);
  if (typeof data.name !== 'string') errors.push('"name" must be a string.');
  if (!Array.isArray(data.nodes)) errors.push('"nodes" must be an array.');
  if (!Array.isArray(data.edges)) errors.push('"edges" must be an array.');
  if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return errors;

  const nodeIds = new Set<string>();
  data.nodes.forEach((node: unknown, i) => {
    if (!isObject(node) || typeof node.id !== 'string' || typeof node.type !== 'string') {
      errors.push(`nodes[${i}] must be an object with string "id" and "type".`);
      return;
    }
    if (nodeIds.has(node.id)) errors.push(`Duplicate node id ${node.id}.`);
    nodeIds.add(node.id);
    if (!isObject(node.parameters) || !Object.values(node.parameters).every((v) => typeof v === 'string')) {
      errors.push(`Node ${node.id}: "parameters" must be an object of strings.`);
    }
    if (!knownTypes.has(node.type)) {
      errors.push(
        `Node ${node.id} has type "${node.type}", which has no CLI executor ` +
          `(known: ${[...knownTypes].join(', ')}). Frontend registry and cli/executors.ts may have drifted.`,
      );
    }
  });

  data.edges.forEach((edge: unknown, i) => {
    if (!isObject(edge) || typeof edge.source !== 'string' || typeof edge.target !== 'string') {
      errors.push(`edges[${i}] must be an object with string "source" and "target".`);
      return;
    }
    const label = typeof edge.id === 'string' ? edge.id : `edges[${i}]`;
    if (!nodeIds.has(edge.source)) errors.push(`Edge ${label} references missing source node ${edge.source}.`);
    if (!nodeIds.has(edge.target)) errors.push(`Edge ${label} references missing target node ${edge.target}.`);
  });

  return errors;
}

export type TopoResult =
  | { ok: true; order: ExportedNode[] }
  | { ok: false; cycle: string[]; blocked: string[] };

/**
 * Kahn's algorithm. Ties are broken by node order in the file so runs are
 * deterministic. On failure, the leftover nodes are split into actual cycle
 * participants and nodes that are merely downstream of a cycle.
 */
export function topologicalSort({ nodes, edges }: ExportedWorkflow): TopoResult {
  const outgoing = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  for (const { source, target } of edges) {
    outgoing.get(source)!.push(target);
    inDegree.set(target, inDegree.get(target)! + 1);
  }

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const queue = nodes.filter((n) => inDegree.get(n.id) === 0).map((n) => n.id);
  const order: ExportedNode[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(byId.get(id)!);
    for (const next of outgoing.get(id)!) {
      const degree = inDegree.get(next)! - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  if (order.length === nodes.length) return { ok: true, order };

  // Leftovers = cycle members + nodes only reachable through a cycle.
  // Repeatedly peel off leftovers with no outgoing edge inside the leftover
  // set; what remains is the set of nodes on (or between) cycles.
  const remaining = new Set(nodes.filter((n) => !order.includes(n)).map((n) => n.id));
  const blocked: string[] = [];
  let peeled = true;
  while (peeled) {
    peeled = false;
    for (const id of remaining) {
      if (!outgoing.get(id)!.some((t) => remaining.has(t))) {
        remaining.delete(id);
        blocked.push(id);
        peeled = true;
      }
    }
  }
  return { ok: false, cycle: [...remaining], blocked };
}

/** Parents of each node (deduplicated), in the given topological order. */
export function parentsInOrder(order: ExportedNode[], edges: ExportedEdge[]): Map<string, string[]> {
  const rank = new Map(order.map((n, i) => [n.id, i]));
  const parents = new Map<string, string[]>(order.map((n) => [n.id, []]));
  for (const { source, target } of edges) {
    const list = parents.get(target)!;
    if (!list.includes(source)) list.push(source);
  }
  for (const list of parents.values()) list.sort((a, b) => rank.get(a)! - rank.get(b)!);
  return parents;
}
