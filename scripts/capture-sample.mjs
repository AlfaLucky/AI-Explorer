import { once } from 'node:events';
import { writeFile } from 'node:fs/promises';
import { createExplorerServer } from '../src/server.mjs';
import { explore } from '../src/explorer.mjs';

const server = createExplorerServer();
server.listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  const report = await explore({ base, target: `${base}/demo/` });
  report.target = '/demo/';
  await writeFile(new URL('../public/sample-report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Captured ${report.findings.length} findings across ${report.screens.length} screens.`);
} finally {
  server.close();
}
