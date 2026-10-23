/**
 * Runs the Manzil ingest workflow (examples/manzil/manzil-ingest.json) for one
 * SharePoint project folder, live, without the API server's run time limit.
 *
 *   npm run ingest -- "<folder under the root>" [--project <id>] [--library <name>] [--root <path>] [--workflow <file>]
 *
 * Defaults: library "ProjectExecution", root "Knowledge Docx - Manzil", project id = folder name.
 * Needs the agent service (`npm run dev:agent`) and the SharePoint, Gemini and Qdrant settings in .env.
 */
import { readFileSync } from 'node:fs';
import type { ExportedWorkflow } from '../frontend/src/types.js';
import { executeWorkflow } from './execute.js';

/* eslint-disable @typescript-eslint/no-explicit-any -- node outputs are untyped JSON */

const USAGE = 'Usage: npm run ingest -- "<folder>" [--project <id>] [--library <name>] [--root <path>] [--workflow <file>]';

function parseArgs(argv: string[]) {
  const options: Record<string, string> = {
    library: 'ProjectExecution',
    root: 'Knowledge Docx - Manzil',
    workflow: 'examples/manzil/manzil-ingest.json',
  };
  let folder: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const value = argv[++i];
      if (!value) throw new Error(`${arg} needs a value.\n${USAGE}`);
      options[arg.slice(2)] = value;
    } else if (!folder) folder = arg;
    else throw new Error(`Unexpected argument ${arg}.\n${USAGE}`);
  }
  if (!folder) throw new Error(USAGE);
  return {
    folder,
    project: options.project ?? folder,
    library: options.library,
    root: options.root,
    workflow: options.workflow,
  };
}

/** One line per node, instead of dumping thousands of vectors. */
function summarize(type: string, out: any): string {
  switch (type) {
    case 'SharePoint': {
      const skipped = out.sharepoint.skipped.map((s: any) => `${s.name} (${s.reason})`);
      return `${out.sharepoint.files.length} files downloaded${skipped.length ? `; skipped: ${skipped.join(', ')}` : ''}`;
    }
    case 'DocumentParser': {
      const noText = out.skippedDocuments.map((s: any) => `${s.name} (${s.skipped})`);
      return `${out.documents.length} documents with text${noText.length ? `; no text: ${noText.join(', ')}` : ''}`;
    }
    case 'TextSplitter':
      return `${out.chunks.length} chunks`;
    case 'Embeddings':
      return `${out.chunks.length} vectors (${out.chunks[0]?.vector?.length ?? 0} dimensions)`;
    case 'QdrantUpsert':
      return `${out.upsert.upserted} points into "${out.upsert.collection}", indexed: ${out.upsert.indexed_fields?.join(', ') || 'none'}`;
    default:
      return '';
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workflow = JSON.parse(readFileSync(args.workflow, 'utf8')) as ExportedWorkflow;
  const reader = workflow.nodes.find((n) => n.type === 'SharePoint');
  if (!reader) throw new Error(`${args.workflow} has no SharePoint node.`);
  reader.parameters.library = args.library;

  const path = `${args.root}/${args.folder}`;
  console.log(`▶ Ingesting ${args.library}/${path} as project "${args.project}"`);
  const started = Date.now();
  const result = await executeWorkflow(workflow, {
    mode: 'live',
    mockPayload: { path, projectId: args.project },
    warn: (m) => console.error(`  ⚠ ${m.slice(0, 300)}`),
    onNodeComplete: (n) =>
      console.log(`${n.status === 'completed' ? '✓' : '✗'} ${n.type} ${(n.durationMs / 1000).toFixed(1)}s  ${n.error ?? summarize(n.type, n.output)}`),
  });
  console.log(`${result.status === 'completed' ? '✓ Done' : '✗ Failed'} in ${Math.round((Date.now() - started) / 1000)}s`);
  if (result.status === 'failed') process.exitCode = 1;
}

main().catch((err) => {
  console.error(`✗ ${(err as Error).message}`);
  process.exitCode = 1;
});
