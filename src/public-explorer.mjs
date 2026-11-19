import { loadBuffer } from 'cheerio';
import robotsParser from 'robots-parser';
import { crawlerName, publicUrl, requestPublicPage } from './public-http.mjs';

const pageLimit = 6;
const requestLimit = 16;
const redirectLimit = 3;
const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const nonPagePath = /\.(?:avif|gif|ico|jpeg|jpg|png|svg|webp|webm|mp4|mp3|pdf|zip|xml|json|css|js|csv|docx?|xlsx?|tar|gz)$/i;
const accountAction = /(?:^|\/)(?:logout|log-out|signout|sign-out|unsubscribe|delete|remove)(?:\/|$)/i;

export function sameSite(candidate, source) {
  const site = (url) => url.hostname.replace(/^www\.|\.$/g, '');
  return site(candidate) === site(source) && (source.protocol === 'http:' || candidate.protocol === 'https:');
}

function inspectHtml(body, current) {
  const $ = loadBuffer(body);
  const baseHref = $('base[href]').first().attr('href');
  const base = baseHref ? publicUrl(baseHref, current) : current;
  const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 150);
  if (!base) return { title, links: [] };

  const links = [];
  const seen = new Set();
  for (const anchor of $('a[href]').toArray()) {
    const element = $(anchor);
    if (element.is('[download]') || element.closest('[hidden], [aria-hidden="true"], template, noscript, form').length) continue;
    const href = element.attr('href').trim();
    if (!href || href.startsWith('#')) continue;
    const url = publicUrl(href, base);
    if (!url || !sameSite(url, current) || url.search || nonPagePath.test(url.pathname) || accountAction.test(url.pathname)) continue;
    if (url.pathname === '/cdn-cgi/l/email-protection') continue;
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    const label = (element.attr('aria-label') || element.text()).replace(/\s+/g, ' ').trim().slice(0, 90);
    links.push({ url, label });
  }
  return { title, links };
}

function failureMessage(error) {
  if (error.code === 'NON_PUBLIC_ADDRESS') return 'The destination is outside the public web.';
  if (error.code === 'ENOTFOUND') return 'The domain could not be resolved.';
  if (['ECONNREFUSED', 'ECONNRESET'].includes(error.code)) return 'The connection was refused or closed.';
  if (error.name === 'AbortError' || error.name === 'TimeoutError') return 'The request timed out.';
  if (/CERT|TLS|SSL/.test(error.code || '')) return 'The HTTPS connection could not be verified.';
  return 'The request did not return a readable response.';
}

export async function explorePublic({ target, publish = () => {}, requestPage = requestPublicPage, signal }) {
  const started = Date.now();
  const deadline = AbortSignal.timeout(14000);
  const runSignal = signal ? AbortSignal.any([deadline, signal]) : deadline;
  const initial = new URL(target);
  const queue = [{ url: initial }];
  const queued = new Set([initial.href]);
  const screens = new Set();
  const requests = [];
  const timeline = [];
  const findings = [];
  const policies = new Map();
  let attempted = 0;
  let requestCount = 0;
  let actions = 0;
  let limited = false;
  let pageLimitReported = false;
  let stop = false;

  function record(kind, text, url, properties = {}) {
    const entry = { kind, text, screen: url.href, elapsedMs: Date.now() - started, ...properties };
    timeline.push(entry);
    publish(entry);
  }

  function finding(entry, url, title, actual, severity = 'Medium') {
    const steps = entry.from
      ? [`Open ${entry.from.href}.`, entry.label ? `Follow the link “${entry.label}”.` : `Follow the link to ${entry.url.href}.`]
      : [`Open ${entry.url.href}.`];
    findings.push({ id: `QA-${String(findings.length + 1).padStart(2, '0')}`, category: 'Navigation',
      screen: url.href, severity, title, steps, expected: 'The page loads successfully.', actual });
    record('finding', title, url);
  }

  async function send(url, robots = false) {
    runSignal.throwIfAborted();
    if (requestCount >= requestLimit) throw Object.assign(new Error('Request limit reached.'), { code: 'RUN_LIMIT' });
    requestCount += 1;
    return requestPage(url, { signal: runSignal, robots });
  }

  async function policyFor(url) {
    if (policies.has(url.origin)) return policies.get(url.origin);
    const robotsUrl = new URL('/robots.txt', url);
    let path = robotsUrl;
    let policy;
    for (let redirect = 0; redirect <= redirectLimit; redirect += 1) {
      const response = await send(path, true);
      if (!redirectStatuses.has(response.status)) {
        const unavailable = response.status === 429 || response.status >= 500 || response.truncated;
        if (unavailable) policy = { unavailable: true };
        else if (response.status === 200) policy = { rules: robotsParser(robotsUrl.href, response.body.toString('utf8')) };
        else policy = {};
        break;
      }
      const redirectUrl = publicUrl(response.location, path);
      if (!redirectUrl || !sameSite(redirectUrl, path)) break;
      path = redirectUrl;
    }
    if (!policy) policy = { unavailable: true };
    policies.set(url.origin, policy);
    return policy;
  }

  async function visit(entry) {
    let url = entry.url;
    const redirects = new Set();
    for (;;) {
      const policy = await policyFor(url);
      if (policy.unavailable || policy.rules?.isAllowed(url.href, crawlerName) === false) {
        limited = true;
        const message = policy.unavailable ? 'Could not verify robots.txt for this origin.' : 'robots.txt disallows this URL.';
        record('log', message, url, { level: 'warning' });
        return;
      }
      if (screens.has(url.href)) return;
      if (redirects.has(url.href) || redirects.size > redirectLimit) {
        finding(entry, url, 'Page redirects repeatedly', 'The navigation reached a redirect loop or exceeded the redirect limit.');
        return;
      }
      const time = Date.now();
      const response = await send(url);
      const { status, media } = response;
      const isRedirect = redirectStatuses.has(status);
      const body = isRedirect ? 'Redirect response' : media || 'No content type provided';
      requests.push({ method: 'GET', path: url.href, status, body, source: 'Page', durationMs: Date.now() - time, screen: url.href });
      record('http', `GET ${url.href} · ${status}`, url, { status, checked: !isRedirect });
      if (isRedirect) {
        const next = publicUrl(response.location, url);
        if (!next || !sameSite(next, url)) {
          limited = true;
          record('log', 'Navigation stopped at a redirect outside the site or without a usable destination.', url, { level: 'warning' });
          return;
        }
        redirects.add(url.href);
        queued.add(next.href);
        url = next;
        continue;
      }
      screens.add(url.href);
      if (status === 401 || status === 403 || status === 429) {
        limited = true;
        stop = true;
        record('log', `The site returned HTTP ${status} and limited access.`, url, { level: 'warning' });
        return;
      }
      if (status >= 400) {
        finding(entry, url, `Page returned HTTP ${status}`, `GET ${url.href} returned HTTP ${status}.`, status >= 500 ? 'High' : 'Medium');
        return;
      }
      if (!response.isHtml) {
        record('log', 'The response is not an HTML page.', url, { level: 'info' });
        return;
      }
      if (response.truncated) {
        limited = true;
        record('log', 'Only part of the HTML response could be read.', url, { level: 'warning' });
      }
      const { title, links } = inspectHtml(response.body, url);
      record('log', title ? `Page title: ${title}` : 'The HTML page has no title.', url, { level: 'info' });
      for (const link of links) {
        if (queued.has(link.url.href)) continue;
        if (queue.length + attempted >= pageLimit) {
          limited = true;
          if (!pageLimitReported) {
            pageLimitReported = true;
            record('log', `The run checks up to ${pageLimit} pages. Additional links were skipped.`, url, { level: 'info' });
          }
          break;
        }
        queued.add(link.url.href);
        queue.push({ ...link, from: url });
      }
      return;
    }
  }

  while (queue.length && !runSignal.aborted && !stop) {
    const entry = queue.shift();
    if (screens.has(entry.url.href)) continue;
    attempted += 1;
    if (entry.from) {
      actions += 1;
      record('action', `Follow ${entry.label || entry.url.href}`, entry.from);
    }
    record('navigation', `Open ${entry.url.href}`, entry.url);
    try {
      await visit(entry);
    } catch (error) {
      if (runSignal.aborted || error.code === 'RUN_LIMIT' || error.code === 'NON_PUBLIC_ADDRESS') {
        limited = true;
        stop = true;
        record('log', error.code === 'NON_PUBLIC_ADDRESS' ? failureMessage(error) : 'The exploration reached its request or time limit.', entry.url, { level: 'warning' });
      } else {
        finding(entry, entry.url, 'Could not load the page', failureMessage(error), 'High');
      }
    }
  }

  return { mode: 'public', target, startedAt: new Date(started).toISOString(), durationMs: Date.now() - started,
    limited: limited || Boolean(queue.length), screens: [...screens], actions, findings, timeline, requests };
}
