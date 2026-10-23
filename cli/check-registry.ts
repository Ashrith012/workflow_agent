/**
 * Manual drift check: frontend node registry vs CLI executor map.
 *
 *   npm run check:registry
 *
 * Exits 1 if any node type exists on one side but not the other.
 */
import { readFileSync } from 'node:fs';
import { executors } from './executors.js';

const REGISTRY_URL = new URL('../frontend/src/nodes/registry.ts', import.meta.url);

async function registryTypes(): Promise<{ types: string[]; via: string }> {
  try {
    const { NODE_DEFINITIONS } = await import('../frontend/src/nodes/registry.js');
    return { types: NODE_DEFINITIONS.map((d) => d.type), via: 'import' };
  } catch (err) {
    // Fallback: registry.ts imports lucide-react icon components, which may
    // fail to load outside the browser bundle. Regex the source instead.
    // Node definitions are the only object literals that *start* with
    // `type:` (parameter entries start with `key:`), which is what we match.
    console.error(`⚠ Could not import registry.ts (${(err as Error).message}); falling back to regex.`);
    const source = readFileSync(REGISTRY_URL, 'utf8');
    const types = [...source.matchAll(/\{\s*type:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
    return { types, via: 'regex' };
  }
}

const { types, via } = await registryTypes();
const frontend = new Set(types);
const cli = new Set(Object.keys(executors));

const missingInCli = [...frontend].filter((t) => !cli.has(t));
const missingInFrontend = [...cli].filter((t) => !frontend.has(t));

console.log(`Registry types (${via}): ${[...frontend].join(', ')}`);
console.log(`CLI executors:          ${[...cli].join(', ')}`);

if (missingInCli.length === 0 && missingInFrontend.length === 0) {
  console.log('✓ Registry and executors are in sync.');
} else {
  for (const t of missingInCli) console.log(`  - ${t}: in registry, no CLI executor`);
  for (const t of missingInFrontend) console.log(`  + ${t}: CLI executor, not in registry`);
  process.exit(1);
}
