import { chromium } from 'playwright';

const actionLimit = 20;
const screenLimit = 8;
const settleTime = 150;

export async function explore({ base, target, publish = () => {} }) {
  const started = Date.now();
  const startPath = new URL(target).pathname;
  const screens = new Set();
  const findings = new Map();
  const timeline = [];
  const requests = [];
  const pendingResponses = new Set();
  let currentPath = startPath;
  let steps = [];
  let screenshots = [];
  let actions = 0;
  let limited = false;

  function record(kind, text, details = {}) {
    const entry = { kind, text, screen: currentPath, elapsedMs: Date.now() - started, ...details };
    timeline.push(entry);
    publish(entry);
  }

  function addFinding(key, evidence) {
    if (findings.has(key)) return;
    const finding = { id: `QA-${String(findings.size + 1).padStart(2, '0')}`, screen: currentPath, steps: [...steps], ...evidence };
    findings.set(key, finding);
    if (finding.category !== 'Contract') screenshots.push(finding);
    record('finding', finding.title);
  }

  function recordApi({ method, path, status, body, source, durationMs }) {
    requests.push({ method, path, status, body, source, durationMs, screen: currentPath });
    record('api', `${method} ${path} · ${status}`, { status });
  }

  const browser = await chromium.launch({ timeout: 8000 });
  try {
    const context = await browser.newContext({ viewport: { width: 960, height: 660 }, serviceWorkers: 'block', acceptDownloads: false });
    context.setDefaultTimeout(1800);
    context.setDefaultNavigationTimeout(3000);
    await context.route('**/*', (route) => {
      const url = new URL(route.request().url());
      return url.origin === base && url.pathname.startsWith('/demo/') ? route.continue() : route.abort();
    });
    const page = await context.newPage();
    page.on('console', (message) => {
      if (message.type() === 'error' && message.text().startsWith('Failed to load resource:')) return;
      record('log', message.text().slice(0, 400), { level: message.type() });
    });
    page.on('pageerror', (error) => addFinding(`javascript:${currentPath}:${error.message}`, {
      title: 'Unhandled JavaScript error', category: 'Browser', severity: 'High',
      expected: 'The screen finishes the action and remains usable.', actual: error.message,
      evidence: String(error.stack || error).replaceAll(base, '').slice(0, 1800)
    }));
    let crashed = false;
    page.on('crash', () => {
      crashed = true;
      addFinding(`crash:${currentPath}`, { title: 'Browser tab crashed', category: 'Browser', severity: 'High',
        expected: 'The screen remains available.', actual: 'Chromium reported a page crash.' });
    });
    page.on('requestfailed', (request) => {
      const { pathname, origin } = new URL(request.url());
      if (origin === base && pathname.startsWith('/demo/api/')) {
        const reason = request.failure()?.errorText ?? 'Unknown transport error';
        addFinding(`transport:${request.method()}:${pathname}`, {
          title: 'API request failed in the browser', category: 'API', severity: 'High',
          expected: 'The server returns an HTTP response.', actual: reason, evidence: `${request.method()} ${pathname}`
        });
      }
    });
    page.on('response', (response) => {
      const { pathname } = new URL(response.url());
      if (!pathname.startsWith('/demo/api/')) return;
      const request = response.request();
      if (response.status() >= 400) {
        addFinding(`http:${request.method()}:${pathname}:${response.status()}`, {
          title: `${request.method()} ${pathname.replace('/demo/api', '')} returned HTTP ${response.status()}`,
          category: 'API', severity: response.status() >= 500 ? 'High' : 'Medium',
          expected: 'The API accepts valid demo input and returns a successful response.',
          actual: `The server returned HTTP ${response.status()}.`
        });
      }
      const pending = response.text().catch(() => '').then((body) => {
        const timing = request.timing().responseEnd;
        const details = { method: request.method(), path: pathname, status: response.status(), body: body.slice(0, 1800),
          source: 'Browser', durationMs: timing >= 0 ? Math.round(timing) : null };
        recordApi(details);
        const finding = findings.get(`http:${details.method}:${pathname}:${details.status}`);
        if (finding) finding.evidence = `${details.method} ${pathname}\n${details.body}`;
      });
      pendingResponses.add(pending);
      void pending.finally(() => pendingResponses.delete(pending));
    });

    async function finishAction() {
      await page.waitForTimeout(settleTime);
      await Promise.allSettled(pendingResponses);
      if (!screenshots.length || crashed) return;
      const screenshot = await page.screenshot({ type: 'jpeg', quality: 74, timeout: 1500, animations: 'disabled' }).catch(() => null);
      if (screenshot) for (const finding of screenshots) finding.screenshot = `data:image/jpeg;base64,${screenshot.toString('base64')}`;
      screenshots = [];
    }

    const queue = [startPath];
    const queued = new Set(queue);
    while (queue.length && screens.size < screenLimit && !crashed) {
      currentPath = queue.shift();
      steps = [`Open ${currentPath} in Fieldwork.`];
      record('navigation', `Open ${currentPath}`);
      try {
        await page.goto(new URL(currentPath, base).href, { waitUntil: 'domcontentloaded' });
        screens.add(currentPath);
        await finishAction();
        const tried = new Set();
        while (actions < actionLimit && !crashed) {
          const inventory = await inspect(page);
          for (const link of inventory.links) {
            if (!queued.has(link)) {
              queue.push(link);
              queued.add(link);
            }
          }
          const next = inventory.actions.find(({ key }) => !tried.has(key));
          if (!next) break;
          tried.add(next.key);
          actions += 1;
          const actionStep = next.fields ? `Fill ${next.fields.map(({ label, value }) => `${label} with “${value}”`).join(', ')} and select “${next.label}”.`
            : `Select “${next.label}”.`;
          steps.push(actionStep);
          record('action', actionStep);
          try {
            if (next.fields) {
              const form = page.locator('form').nth(next.index);
              for (const field of next.fields) {
                const input = form.locator('input, textarea, select').nth(field.index);
                if (field.select) await input.selectOption(field.value);
                else await input.fill(field.value);
              }
              await form.locator('button[type="submit"], button:not([type]), input[type="submit"]').first().click();
            } else await page.locator('button, input[type="button"]').nth(next.index).click();
            await finishAction();
          } catch (error) {
            if (!crashed) record('log', `Action unavailable: ${next.label}. ${error.message.split('\n')[0]}`, { level: 'warning' });
          }
        }
      } catch (error) {
        if (!crashed) record('log', `Could not open ${currentPath}. ${error.message.split('\n')[0]}`, { level: 'warning' });
      }
    }
    limited = Boolean(queue.length || actions >= actionLimit || crashed);

    if (!crashed && screens.size) {
      const contract = await page.locator('link[rel="service-desc"]').getAttribute('href').catch(() => null);
      if (contract?.startsWith('/demo/api/')) {
        const doc = await demoGet(base, contract);
        for (const { path, properties } of doc.data.responses) {
          currentPath = path;
          steps = [`Send GET ${path} using the Fieldwork demo API.`, 'Compare the JSON response with the published demo contract.'];
          const response = await demoGet(base, path);
          recordApi({ method: 'GET', path, status: response.status, body: JSON.stringify(response.data), source: 'Contract', durationMs: response.durationMs });
          for (const [property, expected] of Object.entries(properties)) {
            const value = response.data[property];
            const actual = Array.isArray(value) ? 'array' : Number.isInteger(value) ? 'integer' : typeof value;
            if (actual === expected) continue;
            addFinding(`contract:${path}:${property}`, {
              title: `Unexpected type for ${property}`, category: 'Contract', severity: 'Medium',
              expected: `${property} has type ${expected}.`, actual: `Received type ${actual} with value ${JSON.stringify(value)}.`,
              evidence: JSON.stringify(response.data, null, 2)
            });
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  return { target, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started, limited,
    screens: [...screens], actions, findings: [...findings.values()], timeline, requests };
}

async function demoGet(base, path) {
  const url = new URL(path, base);
  if (url.origin !== base || !url.pathname.startsWith('/demo/api/')) throw new Error('Unexpected demo contract path');
  const start = Date.now();
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(3000) });
  return { data: await response.json(), status: response.status, durationMs: Date.now() - start };
}

function inspect(page) {
  return page.evaluate(() => {
    const visible = (node) => !node.disabled && node.getClientRects().length > 0 && getComputedStyle(node).visibility === 'visible';
    const labelOf = (node) => (node.getAttribute('aria-label') || node.labels?.[0]?.innerText || node.innerText || node.value || node.name || '').trim();
    const inputs = {
      email: 'qa.explorer@example.test', url: 'https://example.test/', tel: '5550100', date: '2026-01-15',
      number: '2', search: 'portal', text: 'QA Explorer', textarea: 'Created during exploratory QA.'
    };
    const links = [...document.querySelectorAll('a[href]')].filter(visible).map((link) => new URL(link.href))
      .filter((url) => url.origin === location.origin && url.pathname.startsWith('/demo/')).map((url) => url.pathname);
    const forms = [...document.forms].map((form, index) => {
      const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
      if (!submit || !visible(submit)) return null;
      const fields = [...form.querySelectorAll('input, textarea, select')].flatMap((input, fieldIndex) => {
        if (!visible(input) || input.readOnly) return [];
        const select = input instanceof HTMLSelectElement;
        const value = select ? [...input.options].find((option) => !option.disabled && option.value)?.value : inputs[input.type];
        if (value === undefined) return [];
        return [{ index: fieldIndex, label: labelOf(input) || input.name || 'field', value, select }];
      });
      const label = labelOf(submit);
      return { index, fields, label, key: `form:${index}:${label}` };
    }).filter(Boolean);
    const buttons = [...document.querySelectorAll('button, input[type="button"]')].flatMap((button, index) => {
      if (!visible(button) || (button.form && button.type !== 'button')) return [];
      const label = labelOf(button);
      return label ? [{ index, label, key: `button:${index}:${label}` }] : [];
    });
    return { links, actions: [...forms, ...buttons] };
  });
}
