const byId = (id) => document.getElementById(id);
const tabs = [...document.querySelectorAll('[role="tab"]')];
const demoUrl = new URL('/demo/', window.location.href).href;
const target = byId('target');
const exportButton = byId('export');
const findingsPanel = byId('findings-panel');
const requestsPanel = byId('requests-panel');
const timelinePanel = byId('timeline-panel');
let report;
let phase = 'loading';

function node(tag, text = '', className = '') {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) element.className = className;
  return element;
}

function status(text, state) {
  const element = byId('report-status');
  element.textContent = text;
  element.dataset.state = state;
}

function setReportLabels(host = '') {
  const external = Boolean(host);
  byId('report-title').textContent = host || 'Fieldwork workspace';
  byId('pages-label').textContent = external ? 'Pages checked' : 'Screens visited';
  byId('actions-label').textContent = external ? 'Links followed' : 'Actions taken';
  byId('requests-label').textContent = external ? 'HTTP responses' : 'API responses';
  byId('tab-requests').textContent = external ? 'HTTP traffic' : 'API traffic';
  byId('engine').textContent = external ? 'HTTP and HTML' : 'Chromium';
  byId('visited-label').textContent = external ? 'Checked pages' : 'Visited screens';
}

function externalHost(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    return url.origin === location.origin ? '' : url.hostname;
  } catch { return ''; }
}

function seconds(elapsedMs) { return `${(elapsedMs / 1000).toFixed(1)}s`; }

function selectTab(tab, focus = false) {
  for (const item of tabs) {
    const selected = item === tab;
    item.setAttribute('aria-selected', String(selected));
    item.tabIndex = selected ? 0 : -1;
    byId(item.getAttribute('aria-controls')).hidden = !selected;
  }
  if (focus) tab.focus();
}

for (const [index, tab] of tabs.entries()) {
  tab.addEventListener('click', () => selectTab(tab));
  tab.addEventListener('keydown', (event) => {
    const options = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 };
    if (!Object.hasOwn(options, event.key)) return;
    event.preventDefault();
    selectTab(tabs[options[event.key]], true);
  });
}

function renderFinding(finding) {
  const details = node('details', '', 'finding');
  const summary = node('summary');
  const icon = node('span', finding.category === 'Browser' ? '!' : finding.category === 'API' ? '↔' : '{}', 'finding-icon');
  icon.dataset.category = finding.category;
  icon.setAttribute('aria-hidden', 'true');
  const title = node('span', '', 'finding-title');
  title.append(node('strong', finding.title), node('small', `${finding.category} · ${finding.screen}`));
  summary.append(icon, title, node('span', finding.severity, `severity ${finding.severity.toLowerCase()}`));

  const detail = node('div', '', 'finding-body');
  const steps = node('ol');
  steps.append(...finding.steps.map((step) => node('li', step)));
  detail.append(node('h4', 'Steps to reproduce'), steps, node('h4', 'Expected'), node('p', finding.expected), node('h4', 'Observed'), node('p', finding.actual));
  if (finding.evidence) detail.append(node('h4', 'Log or API response'), node('pre', finding.evidence, 'evidence'));
  if (finding.screenshot) {
    const img = node('img', '', 'screenshot');
    img.src = finding.screenshot;
    img.alt = `Fieldwork after the issue on ${finding.screen}`;
    img.loading = 'lazy';
    detail.append(node('h4', 'Screenshot'), img);
  }
  details.append(summary, detail);
  return details;
}

function timelineEvent(event) {
  const row = node('li');
  row.append(node('time', `+${seconds(event.elapsedMs)}`), node('span', event.level || event.kind, 'timeline-type'), node('span', event.text));
  return row;
}

function renderRequest(request) {
  const details = node('details', '', 'api-row');
  const summary = node('summary');
  summary.append(node('code', `${request.method} ${request.path}`), node('span', request.source, 'source-label muted'),
    node('span', String(request.status), request.status >= 400 ? 'api-code bad' : 'api-code'));
  let body = request.body;
  try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Display the observed body as text. */ }
  details.append(summary, node('p', request.durationMs === null ? request.screen : `${request.screen} · ${request.durationMs} ms`),
    node('pre', body || 'Empty response', 'evidence'));
  return details;
}

function metrics({ screens, actions, requests, findings }) {
  byId('screens').textContent = screens;
  byId('actions').textContent = actions;
  byId('requests').textContent = requests;
  byId('count').textContent = findings;
}

function showReport(value, sample) {
  report = value;
  phase = 'ready';
  const external = value.mode === 'public';
  setReportLabels(external ? new URL(value.target).hostname : '');
  metrics({ screens: value.screens.length, actions: value.actions, requests: value.requests.length, findings: value.findings.length });
  byId('mode').textContent = sample ? 'Recorded demo' : external ? 'Public site' : 'Fieldwork live';
  byId('duration').textContent = seconds(value.durationMs);
  status(sample ? 'Sample report' : value.limited ? 'Partial run' : 'Run complete', sample || value.limited ? 'sample' : 'complete');
  const screens = value.screens.map((path) => {
    const item = node('li');
    const url = new URL(path, location.origin);
    const link = node('a', external ? `${url.pathname}${url.search}` : path);
    link.href = path;
    if (external) {
      link.title = url.href;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
    }
    item.append(link);
    return item;
  });
  if (!screens.length) screens.push(node('li', 'No pages could be checked.', 'muted'));
  byId('visited').replaceChildren(...screens);
  const findings = [...value.findings].sort((a, b) => Number(b.severity === 'High') - Number(a.severity === 'High'));
  const emptyFindings = value.limited
    ? 'No issues were detected in this partial run. See the activity log for limits.'
    : 'No issues were detected in the pages checked.';
  findingsPanel.replaceChildren(...(findings.length ? findings.map(renderFinding) : [node('p', emptyFindings, 'empty')]));
  const timeline = node('ol', '', 'timeline');
  timeline.append(...value.timeline.map(timelineEvent));
  timelinePanel.replaceChildren(timeline);
  requestsPanel.replaceChildren(...(value.requests.length ? value.requests.map(renderRequest) : [node('p', 'No responses were recorded.', 'empty')]));
  exportButton.disabled = false;
}

async function loadSample() {
  try {
    const response = await fetch('/sample-report.json');
    if (!response.ok) throw new Error('Sample unavailable');
    const sample = await response.json();
    if (phase === 'loading') showReport(sample, true);
  } catch {
    if (phase !== 'loading') return;
    phase = 'ready';
    status('Ready to explore', 'sample');
    findingsPanel.replaceChildren(node('p', 'Run an exploration to see findings.', 'empty'));
  }
}

async function readRun(response, onMessage) {
  if (!response.ok) throw new Error((await response.json()).error);
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let pending = '';
  let completed;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      pending += value;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        const message = JSON.parse(line);
        if (message.type === 'error') throw new Error(message.message);
        if (message.type === 'completed') completed = message.report;
        if (message.type === 'event') onMessage(message.event);
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (!completed) throw new Error('The connection ended before the report was ready. Try again.');
  return completed;
}

target.value = demoUrl;
byId('use-demo').addEventListener('click', () => { target.value = demoUrl; target.focus(); });

byId('launch').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (phase === 'running') return;
  phase = 'running';
  byId('error').hidden = true;
  byId('run').disabled = true;
  byId('run-label').textContent = 'Exploring…';
  exportButton.disabled = true;
  const input = target.value.trim();
  const host = externalHost(input);
  setReportLabels(host);
  status(host ? 'Exploring public site' : 'Exploring Fieldwork', 'running');
  byId('mode').textContent = host ? 'Public site' : 'Fieldwork live';
  const live = { screens: 0, actions: 0, requests: 0, findings: 0 };
  metrics(live);
  byId('duration').textContent = '—';
  byId('visited').replaceChildren(node('li', host ? 'Checking pages…' : 'Visiting demo screens…', 'muted'));
  findingsPanel.replaceChildren(node('p', 'Findings appear when the run finishes.', 'empty'));
  requestsPanel.replaceChildren(node('p', 'Collecting responses…', 'empty'));
  const progress = node('ol', '', 'timeline');
  timelinePanel.replaceChildren(progress);
  selectTab(byId('tab-timeline'));
  try {
    const response = await fetch('/api/runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ target: input }) });
    const result = await readRun(response, (step) => {
      progress.append(timelineEvent(step));
      const counter = { navigation: 'screens', action: 'actions', api: 'requests', http: 'requests', finding: 'findings' }[step.kind];
      if (counter && !(host && step.kind === 'navigation')) live[counter] += 1;
      if (step.checked) live.screens += 1;
      metrics(live);
    });
    showReport(result, false);
    selectTab(byId('tab-findings'));
  } catch (error) {
    phase = 'ready';
    byId('error').hidden = false;
    byId('error').textContent = error.message;
    if (report) showReport(report, report.target === '/demo/');
    else {
      status('Run unavailable', 'error');
      findingsPanel.replaceChildren(node('p', 'Run an exploration to see findings.', 'empty'));
    }
    selectTab(byId('tab-findings'));
  } finally {
    byId('run').disabled = false;
    byId('run-label').textContent = 'Run exploration';
  }
});

exportButton.addEventListener('click', () => {
  if (!report) return;
  const publicReport = { ...report, target: new URL(report.target, location.origin).href };
  const url = URL.createObjectURL(new Blob([JSON.stringify(publicReport, null, 2)], { type: 'application/json' }));
  const link = node('a');
  link.href = url;
  link.download = 'ai-explorer-report.json';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
});

void loadSample();
