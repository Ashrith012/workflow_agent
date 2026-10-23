/**
 * Phase 0 workflow interpreter.
 *
 *   npm run run:wf -- <workflow.json> [--live] [--mock <payload.json>]
 *
 * Exit code 0 on success, 1 on any usage, validation, cycle or node error.
 * Execution itself lives in cli/execute.ts (shared with the HTTP server);
 * this file only parses arguments, loads files and formats the log.
 */
import { readFileSync } from 'node:fs';
import type { ExportedWorkflow } from '../frontend/src/types.js';
import { executeWorkflow } from './execute.js';
import { formatValue } from './log.js';
import { findCycle, validateWorkflowShape } from './validate.js';

const USAGE = 'Usage: npm run run:wf -- <workflow.json> [--live] [--mock <payload.json>]';

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let file: string | undefined;
  let live = false;
  let mockFile: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--live') live = true;
    else if (arg === '--mock') {
      mockFile = argv[++i];
      if (!mockFile || mockFile.startsWith('--')) fail(`--mock requires a file path.\n${USAGE}`);
    } else if (arg === '--help' || arg === '-h') {
      console.log(USAGE);
      process.exit(0);
    } else if (arg.startsWith('--')) fail(`Unknown flag ${arg}.\n${USAGE}`);
    else if (file) fail(`Unexpected extra argument ${arg}.\n${USAGE}`);
    else file = arg;
  }

  if (!file) fail(`Missing workflow file.\n${USAGE}`);
  return { file, live, mockFile };
}

function readJson(path: string, what: string): unknown {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    fail(`Cannot read ${what} ${path}: ${(err as Error).message}`);
  }
  try {
    return JSON.parse(text);
  } catch (err) {
    fail(`${what} ${path} is not valid JSON: ${(err as Error).message}`);
  }
}

async function main() {
  const { file, live, mockFile } = parseArgs(process.argv.slice(2));

  // 1. Load + validate
  const data = readJson(file, 'workflow file');
  const errors = validateWorkflowShape(data);
  if (errors.length > 0) {
    fail(`Invalid workflow ${file}:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  const workflow = data as ExportedWorkflow;
  const mockPayload = mockFile ? readJson(mockFile, 'mock payload') : undefined;

  // 2. Refuse cycles before printing the header
  const cycle = findCycle(workflow);
  if (cycle) fail(cycle.message);

  const count = workflow.nodes.length;
  console.log(`▶ ${workflow.name} — ${count} node${count === 1 ? '' : 's'}`);
  console.log(`  mode: ${live ? 'live' : 'mock'}${mockFile ? `, webhook payload from ${mockFile}` : ''}\n`);

  // 3. Execute, logging each node as it finishes
  const result = await executeWorkflow(workflow, {
    mode: live ? 'live' : 'mock',
    mockPayload,
    onNodeComplete: (node, { index, total }, error) => {
      const step = `[${index + 1}/${total}] ${node.type} (${node.id})`;
      if (node.status === 'completed') {
        console.log(`${step} ✓ ${node.durationMs}ms`);
        console.log(`    input:  ${formatValue(node.input, '    ')}`);
        console.log(`    output: ${formatValue(node.output, '    ')}`);
      } else {
        console.log(`${step} ✗ ${node.durationMs}ms`);
        console.error(`✗ Node ${node.id} (${node.type}) failed: ${node.error}`);
        if (error?.stack) console.error(error.stack);
      }
    },
  });

  if (result.status === 'failed') {
    // Not process.exit(): after a fetch, exiting with open keep-alive sockets
    // trips a libuv assertion on Windows (exit 127). Let the loop drain instead.
    process.exitCode = 1;
    return;
  }

  // 4. Summary: terminal node outputs
  const types = new Map(result.nodes.map((n) => [n.id, n.type]));
  console.log(`\n✓ Workflow completed in ${result.durationMs}ms`);
  for (const [id, output] of Object.entries(result.output as Record<string, unknown>)) {
    console.log(`  ${types.get(id)} (${id}): ${formatValue(output, '  ')}`);
  }
}

main().catch((err) => {
  console.error('✗ Unexpected error:', err);
  process.exitCode = 1;
});
