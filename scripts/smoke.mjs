#!/usr/bin/env node
/**
 * @fileoverview End-to-end smoke test over HTTP against a running stack
 * (`pnpm dev`, or a deployed environment via BASE_URL). Walks the whole
 * loop: login → import pack → 3 sources → batches → objects → risk update
 * → alert → recommendation → approve → executed.
 *
 *   BASE_URL=http://127.0.0.1:8787 node scripts/smoke.mjs
 */

import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.env.BASE_URL ?? 'http://127.0.0.1:8787') + '/api/v1';
const EMAIL = process.env.SMOKE_EMAIL ?? 'admin@ontodecide.local';
const PASSWORD = process.env.SMOKE_PASSWORD ?? 'Admin12345!';

let token = '';

async function api(method, path, body, headers = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      'accept-language': 'en-US',
      ...(token ? {authorization: `Bearer ${token}`} : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(
      `${method} ${path} → ${res.status} ${data?.code ?? ''} ${data?.detail ?? text}`,
    );
  }
  return data;
}

function parseCsv(file) {
  const [header, ...lines] = readFileSync(file, 'utf8').trim().split('\n');
  const cols = header.split(',');
  return lines.map(line =>
    Object.fromEntries(line.split(',').map((v, i) => [cols[i], v])),
  );
}

async function waitFor(label, fn, timeoutMs = 30_000) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs)
      throw new Error(`Timed out waiting for ${label}`);
    await new Promise(r => setTimeout(r, 500));
  }
}

function step(msg) {
  console.log(`✔ ${msg}`);
}

const SOURCES = [
  {
    file: 'suppliers.csv',
    def: {
      name: 'Suppliers (smoke)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Supplier',
        primaryKey: {from: 'supplierId'},
        fields: [
          {to: 'supplierId', from: 'supplierId'},
          {to: 'name', from: 'name', transform: 'trim'},
          {to: 'country', from: 'country'},
          {
            to: 'riskScore',
            from: 'riskScore',
            transform: 'toNumber|clamp(0,100)',
          },
          {to: 'capacity', from: 'capacity', transform: 'toNumber'},
          {to: 'onTimeRate', from: 'onTimeRate', transform: 'toNumber'},
          {to: 'status', from: 'status'},
          {to: 'contactEmail', from: 'contactEmail'},
        ],
        links: [
          {
            type: 'supplies',
            toType: 'Material',
            toKey: 'materials',
            split: ';',
            weightFrom: 'share',
          },
        ],
      },
    },
  },
  {
    file: 'materials.csv',
    def: {
      name: 'Materials (smoke)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Material',
        primaryKey: {from: 'materialId'},
        fields: [
          {to: 'materialId', from: 'materialId'},
          {to: 'name', from: 'name'},
          {to: 'category', from: 'category'},
          {to: 'unitCost', from: 'unitCost', transform: 'toNumber'},
        ],
        links: [
          {type: 'usedIn', toType: 'Product', toKey: 'products', split: ';'},
        ],
      },
    },
  },
  {
    file: 'products.csv',
    def: {
      name: 'Products (smoke)',
      kind: 'file',
      config: {format: 'csv'},
      mapping: {
        targetType: 'Product',
        primaryKey: {from: 'productId'},
        fields: [
          {to: 'productId', from: 'productId'},
          {to: 'name', from: 'name'},
          {to: 'dailyDemand', from: 'dailyDemand', transform: 'toNumber'},
          {to: 'inventoryDays', from: 'inventoryDays', transform: 'toNumber'},
          {
            to: 'safetyStockDays',
            from: 'safetyStockDays',
            transform: 'toNumber',
          },
          {to: 'revenuePerUnit', from: 'revenuePerUnit', transform: 'toNumber'},
        ],
      },
    },
  },
];

async function main() {
  const health = await api('GET', '/health');
  step(`gateway healthy (${health.version})`);

  const login = await api('POST', '/auth/login', {
    email: EMAIL,
    password: PASSWORD,
  });
  token = login.accessToken;
  step(`logged in as ${login.user.email} (${login.user.role})`);

  await api('POST', '/ontology/packs:import', {packId: 'supply-chain'});
  const model = await api('GET', '/ontology/model');
  step(
    `supply-chain pack published: ${Object.keys(model.objectTypes).join(', ')}`,
  );

  const sourceIds = {};
  for (const s of SOURCES) {
    const existing = (await api('GET', '/sources')).find(
      x => x.name === s.def.name,
    );
    const src = existing ?? (await api('POST', '/sources', s.def));
    sourceIds[s.file] = src.id;
    const rows = parseCsv(join(ROOT, 'samples/supply-chain', s.file));
    const res = await api(
      'POST',
      `/sources/${src.id}/batches`,
      {seq: 0, last: true, records: rows},
      {
        'idempotency-key': `smoke-${Date.now()}-${s.file}`,
      },
    );
    const job = await waitFor(`job ${res.jobId}`, async () => {
      const j = await api('GET', `/jobs/${res.jobId}`);
      return j.finishedAt ? j : null;
    });
    step(
      `${s.file}: job ${job.status} received=${job.received} upserted=${job.upserted} merged=${job.merged} skipped=${job.skipped} rejected=${job.rejected}`,
    );
  }

  const products = await api('GET', '/objects/Product?limit=50');
  step(`objects visible: ${products.items.length} products`);

  // Raise the risk of S-002 above the automation threshold (riskScore ≥ 70).
  const riskRows = parseCsv(join(ROOT, 'samples/supply-chain/suppliers.csv'))
    .filter(r => r.supplierId === 'S-002')
    .map(r => ({...r, riskScore: String(80 + Math.floor(Math.random() * 15))}));
  await api('POST', `/sources/${sourceIds['suppliers.csv']}/batches`, {
    seq: 0,
    last: true,
    records: riskRows,
  });

  const alert = await waitFor('HIGH alert', async () => {
    const alerts = await api('GET', '/alerts?status=OPEN');
    return alerts.find(a => a.severity === 'HIGH');
  });
  step(`alert raised: ${alert.title} (${alert.severity})`);

  const rec = await waitFor(
    'proposed recommendation',
    async () => {
      const recs = await api('GET', '/recommendations?status=Proposed');
      return recs.find(r => r.alertId === alert.id) ?? null;
    },
    60_000,
  );
  step(
    `recommendation ${rec.id}: "${rec.summary}" via ${rec.model} (confidence ${rec.confidence})`,
  );

  const approved = await api(
    'POST',
    `/recommendations/${rec.id}/approve`,
    undefined,
    {
      'idempotency-key': `smoke-approve-${rec.id}`,
    },
  );
  step(`approved → ${approved.status}`);
  if (approved.status !== 'Executed')
    throw new Error('Recommendation was not executed');

  const overview = await api('GET', '/situation/overview');
  step(
    `cockpit: ${overview.kpis.length} KPIs, ${overview.alerts.length} alerts, usage level ${overview.usage.level}`,
  );
  console.log('\nSmoke test passed.');
}

main().catch(err => {
  console.error(`✘ ${err.message}`);
  process.exit(1);
});
