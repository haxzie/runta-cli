/**
 * Deletes every runtime the eval created. Safe to run any time: it only touches names that start
 * with `ev-` (or `ev-<run-id>-` when a run id is given).
 *
 *   bun src/cleanup.ts            # dry run
 *   bun src/cleanup.ts --yes
 *   bun src/cleanup.ts --run-id k3f9 --yes
 */

import { parseArgs } from 'node:util';
import { Api } from './api.js';

const { values } = parseArgs({
  options: { 'run-id': { type: 'string' }, yes: { type: 'boolean', default: false } },
});
const token = process.env.RUNTA_TOKEN;
if (!token) {
  console.error('error RUNTA_TOKEN is not set.');
  process.exit(2);
}
const api = new Api(token, process.env.RUNTA_API_URL);
const prefix = values['run-id'] ? `ev-${values['run-id']}-` : 'ev-';
const targets = (await api.listByPrefix(prefix)).filter((r) => r.status !== 'deleting');

if (targets.length === 0) {
  console.log(`Nothing starts with '${prefix}'.`);
} else {
  for (const r of targets)
    console.log(
      `${values.yes ? 'deleting' : 'would delete'} ${r.display_name} (${r.id}) — ${r.status}`,
    );
  if (values.yes) await Promise.all(targets.map((r) => api.delete(r.id)));
  else console.log('Dry run. Pass --yes to delete.');
}
