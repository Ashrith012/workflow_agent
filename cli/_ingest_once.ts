// Temporary runner (deleted after use): ingest one SharePoint project folder with examples/manzil/manzil-ingest.json.
import { readFileSync } from 'node:fs';
import { executeWorkflow } from './execute.js';
import type { ExportedWorkflow } from '../frontend/src/types.js';

const [folder, projectId] = process.argv.slice(2);
const wf = JSON.parse(readFileSync('examples/manzil/manzil-ingest.json', 'utf8')) as ExportedWorkflow;
wf.nodes.find((n) => n.id === 'read_folder')!.parameters.library = 'ProjectExecution';

const summary = (type: string, out: any): string => {
  switch (type) {
    case 'SharePoint': return `${out.sharepoint.files.length} files downloaded, ${out.sharepoint.skipped.length} skipped ${JSON.stringify(out.sharepoint.skipped.map((s: any) => `${s.name}: ${s.reason}`))}`;
    case 'DocumentParser': return `${out.documents.length} parsed, ${out.skippedDocuments.length} without text ${JSON.stringify(out.skippedDocuments.map((s: any) => `${s.name}: ${s.skipped}`))}`;
    case 'TextSplitter': return `${out.chunks.length} chunks`;
    case 'Embeddings': return `${out.chunks.length} vectors of ${out.chunks[0]?.vector?.length}`;
    case 'QdrantUpsert': return JSON.stringify(out.upsert);
    default: return '';
  }
};
const started = Date.now();
const result = await executeWorkflow(wf, {
  mode: 'live',
  mockPayload: { path: `Knowledge Docx - Manzil/${folder}`, projectId },
  warn: (m) => console.error(`  warn: ${m.slice(0, 200)}`),
  onNodeComplete: (n) => console.log(`${n.status === 'completed' ? '✓' : '✗'} ${n.type} ${(n.durationMs / 1000).toFixed(1)}s ${n.error ?? summary(n.type, n.output)}`),
});
console.log(`${result.status} in ${((Date.now() - started) / 1000).toFixed(0)}s`);
