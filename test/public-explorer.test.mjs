import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explorePublic } from '../src/public-explorer.mjs';
import { isPublicAddress, publicUrl, resolvePublicAddress } from '../src/public-http.mjs';

test('accepts public URLs and rejects local or special-use destinations', async () => {
  assert.equal(publicUrl('mayflower.work')?.href, 'https://mayflower.work/');
  assert.equal(publicUrl('https://www.iana.org/domains/reserved#intro')?.href, 'https://www.iana.org/domains/reserved');
  for (const url of [
    'file:///tmp/report', 'http://localhost/', 'http://127.0.0.1/', 'http://2130706433/', 'http://[::1]/',
    'https://example.com:8443/', 'https://name:pass@example.com/', 'https://metadata.google.internal/'
  ]) assert.equal(publicUrl(url), null, url);
  for (const address of ['100.64.0.1', '169.254.169.254', '168.63.129.16', '::ffff:127.0.0.1', '64:ff9b::a00:1', '2002:7f00:1::']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  await assert.rejects(resolvePublicAddress('example.com', async () => ['93.184.216.34', '10.0.0.1']), { code: 'NON_PUBLIC_ADDRESS' });
  assert.deepEqual(await resolvePublicAddress('example.com', async () => ['93.184.216.34']), { address: '93.184.216.34', family: 4 });
});

test('follows public HTML links, respects robots, and records reproducible broken navigation', async () => {
  const seen = [];
  const pages = {
    '/robots.txt': ['User-agent: AIExplorer\nDisallow: /excluded'],
    '/': [`<title>Example</title><main>
      <a href="/about">About</a><a href="/missing">Missing</a><a href="/excluded">Excluded</a>
      <a href="https://iana.org/">External site</a><a href="/download.pdf">Download</a>
      <a href="/sign-out">Sign out</a><a href="/search?q=company">Search</a>
      <a href="/cdn-cgi/l/email-protection#encoded">Email contact</a>
      <form><a href="/form-only">Form link</a></form><a href="#team">In-page link</a>
    </main>`],
    '/about': ['<title>About</title><a href="/broken-redirect">Redirect</a>'],
    '/missing': ['', 404],
    '/broken-redirect': ['', 302, 'https://iana.org/']
  };
  const report = await explorePublic({ target: 'https://example.com/', requestPage: async (url) => {
    seen.push(url.href);
    const [body, status = 200, location] = pages[url.pathname];
    return { status, location, body: Buffer.from(body), media: 'text/html', isHtml: true };
  } });
  assert.equal(report.mode, 'public');
  assert.deepEqual(seen, ['/robots.txt', '/', '/about', '/missing', '/broken-redirect'].map((path) => `https://example.com${path}`));
  assert.equal(report.requests.length, 4);
  assert.equal(report.findings.length, 1);
  assert.deepEqual(report.findings[0].steps, ['Open https://example.com/.', 'Follow the link “Missing”.']);
  assert.ok(report.timeline.some(({ text }) => text.includes('robots.txt disallows')));
  assert.ok(report.timeline.some(({ text }) => text.includes('outside the site')));
});

test('reports redirect loops and bounds the number of pages per run', async () => {
  const seen = [];
  const report = await explorePublic({ target: 'https://example.com/', requestPage: async (url) => {
    seen.push(url.pathname);
    if (url.pathname === '/robots.txt') return { status: 404 };
    if (url.pathname === '/loop') return { status: 301, location: '/loop' };
    const links = Array.from({ length: 15 }, (_, i) => `<a href="/page${i}">Page ${i}</a>`).join('');
    const body = url.pathname === '/' ? `<a href="/loop">Loop</a>${links}` : '<title>Page</title>';
    return { status: 200, isHtml: true, body: Buffer.from(body) };
  } });
  assert.deepEqual(seen, ['/robots.txt', '/', '/loop', '/page0', '/page1', '/page2', '/page3']);
  assert.equal(report.findings[0].title, 'Page redirects repeatedly');
  assert.equal(report.limited, true);
});
