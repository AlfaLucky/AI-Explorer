import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { createExplorerServer, resolveTarget } from '../src/server.mjs';

test('only built-in demo pages from configured origins are valid targets', () => {
  const origin = 'https://explorer.example.test';
  const allowed = new Set([origin]);
  assert.equal(resolveTarget(`${origin}/demo`, allowed), `${origin}/demo/`);
  assert.equal(resolveTarget(`${origin}/demo/projects/new`, allowed), `${origin}/demo/projects/new`);
  for (const target of [
    'https://fieldwork.example.test/demo/', 'https://explorer.example.test@other.example.test/demo/',
    `${origin}/demo/unknown`, `${origin}/demo/api/contract`, `${origin}/demo/../`, `${origin}/demo/?next=1`, `${origin}/demo/#fragment`
  ]) assert.equal(resolveTarget(target, allowed), null, target);
});

test('starts a Chromium run and streams a complete demo report', async (t) => {
  const server = createExplorerServer({ cooldownMs: 0 });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const run = (target) => fetch(`${origin}/api/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target }) });
  assert.equal((await run('https://external.example.test/demo/')).status, 400);
  const response = await run(`${origin}/demo/`);
  assert.equal(response.status, 200);
  assert.equal((await run(`${origin}/demo/`)).status, 429);
  const messages = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
  assert.equal(messages[0].type, 'started');
  assert.equal(messages.at(-1).type, 'completed');
  const { report } = messages.at(-1);
  assert.equal(report.limited, false);
  assert.equal(report.screens.length, 5);
  assert.equal(report.actions, 4);
  assert.deepEqual(new Set(report.findings.map(({ category }) => category)), new Set(['Browser', 'API', 'Contract']));
  assert.ok(report.findings.every(({ steps }) => steps.length > 1));
  assert.ok(report.findings.find(({ category }) => category === 'Browser').screenshot.startsWith('data:image/jpeg;base64,'));
  assert.ok(report.timeline.some(({ kind, text }) => kind === 'log' && text.includes('created a project')));
  assert.ok(report.requests.some(({ source, status }) => source === 'Browser' && status === 500));
  assert.ok(report.requests.some(({ source, status }) => source === 'Contract' && status === 200));
});
