#!/usr/bin/env node
/**
 * Generate static OpenAPI specification files for every OntoDecide Worker.
 *
 * The script imports each Worker's compiled `fetch` handler and makes an
 * internal request to the `/openapi.json` endpoint, then writes the
 * resulting JSON to `docs/openapi/<service>.json`.
 *
 * Prerequisites:
 *   pnpm -r build
 *
 * Usage:
 *   node scripts/generate-openapi.mjs
 */
import {writeFile, mkdir} from 'node:fs/promises';
import {resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const OUTPUT_DIR = resolve(ROOT, 'docs', 'openapi');

const WORKERS = [
  {name: 'gateway', path: 'apps/api/gateway/dist/index.js'},
  {name: 'user', path: 'apps/api/user/dist/index.js'},
  {name: 'graph', path: 'apps/api/graph/dist/index.js'},
  {name: 'ingestion', path: 'apps/api/ingestion/dist/index.js'},
  {name: 'ai', path: 'apps/api/ai/dist/index.js'},
  {name: 'cleanup', path: 'apps/api/cleanup/dist/index.js'},
];

async function generateSpec(name, workerPath) {
  const modulePath = resolve(ROOT, workerPath);
  const worker = await import(modulePath);
  const handler = worker.default?.fetch ?? worker.default;

  if (typeof handler !== 'function') {
    throw new Error(`Worker "${name}" does not export a fetch handler.`);
  }

  const request = new Request('http://localhost/openapi.json', {
    headers: {
      'x-internal-call': '1',
      'x-trace-id': 'openapi-gen',
    },
  });

  const response = await handler(request, {}, {});

  if (!response.ok) {
    const body = await response.text().catch(() => '<unreadable>');
    throw new Error(
        `Worker "${name}" returned ${response.status}: ${body.slice(0, 200)}`,
    );
  }

  const spec = await response.json();
  const outputPath = resolve(OUTPUT_DIR, `${name}.json`);
  await writeFile(outputPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  return {name, path: outputPath, pathCount: Object.keys(spec.paths || {}).length};
}

async function main() {
  await mkdir(OUTPUT_DIR, {recursive: true});
  const results = [];
  for (const worker of WORKERS) {
    try {
      const result = await generateSpec(worker.name, worker.path);
      results.push(result);
      console.log(`  ✓ ${worker.name}: ${result.pathCount} paths → ${result.path}`);
    } catch (err) {
      console.error(`  ✗ ${worker.name}: ${err.message}`);
      process.exitCode = 1;
    }
  }
  if (results.length > 0) {
    console.log(`\nGenerated ${results.length} OpenAPI spec(s) in ${OUTPUT_DIR}`);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
