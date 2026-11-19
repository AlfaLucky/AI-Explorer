import { Resolver } from 'node:dns/promises';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { isIP } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import ipaddr from 'ipaddr.js';

export const crawlerName = 'AIExplorer';
const maxBodyBytes = 640 * 1024;
const globalIPv6 = ipaddr.parse('2000::');
const reservedHostname = /(?:^|\.)(?:localhost|local|localdomain|internal|test|invalid|example|onion|lan|corp|home\.arpa)$/i;
const cloudWireServer = '168.63.129.16';
const decoders = { br: createBrotliDecompress, gzip: createGunzip, deflate: createInflate };

function hostnameOf(url) {
  return url.hostname.replace(/^\[|\]$|\.$/g, '');
}

export function isPublicAddress(value) {
  if (!isIP(value) || value === cloudWireServer) return false;
  const address = ipaddr.parse(value);
  return address.range() === 'unicast' && (address.kind() === 'ipv4' || address.match(globalIPv6, 3));
}

export function publicUrl(value, base) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1800) return null;
  try {
    const trimmed = value.trim();
    const url = base ? new URL(trimmed, base) : new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = hostnameOf(url);
    if (isIP(hostname) ? !isPublicAddress(hostname) : !hostname.includes('.') || reservedHostname.test(hostname)) return null;
    url.hash = '';
    return url;
  } catch { return null; }
}

const dns = new Resolver({ timeout: 1200, tries: 1 });

async function resolveAddresses(hostname) {
  const results = await Promise.allSettled([dns.resolve4(hostname), dns.resolve6(hostname)]);
  return results.flatMap((result) => result.status === 'fulfilled' ? result.value : []);
}

export async function resolvePublicAddress(hostname, resolve = resolveAddresses) {
  const addresses = isIP(hostname) ? [hostname] : await resolve(hostname);
  if (!addresses.length) throw Object.assign(new Error('The domain did not resolve.'), { code: 'ENOTFOUND' });
  if (!addresses.every(isPublicAddress)) {
    throw Object.assign(new Error('Only publicly routable addresses can be explored.'), { code: 'NON_PUBLIC_ADDRESS' });
  }
  const address = addresses[0];
  return { address, family: isIP(address) };
}

export async function requestPublicPage(url, { signal, robots = false } = {}) {
  const target = publicUrl(url.href);
  if (!target) throw Object.assign(new Error('Unsupported destination.'), { code: 'NON_PUBLIC_ADDRESS' });
  const timeout = AbortSignal.timeout(3500);
  const deadline = signal ? AbortSignal.any([timeout, signal]) : timeout;
  const pinned = await resolvePublicAddress(hostnameOf(target));
  deadline.throwIfAborted();

  return new Promise((resolve, reject) => {
    const request = target.protocol === 'https:' ? httpsRequest : httpRequest;
    const outgoing = request(target, {
      method: 'GET', agent: false, signal: deadline,
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [pinned]);
        else callback(null, pinned.address, pinned.family);
      },
      headers: {
        'User-Agent': `${crawlerName}/1.0 (+https://github.com/AlfaLucky/AI-Explorer)`,
        'Accept': robots ? 'text/plain, */*;q=0.1' : 'text/html, application/xhtml+xml;q=0.9, */*;q=0.1',
        'Accept-Encoding': 'identity'
      }
    }, (response) => {
      readBody(response, robots).then(resolve, reject);
    });
    outgoing.once('error', reject);
    outgoing.end();
  });
}

async function readBody(response, robots) {
  const status = response.statusCode;
  const media = (response.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
  const isHtml = media === 'text/html' || media === 'application/xhtml+xml';
  const result = { status, location: response.headers.location, media, isHtml, body: Buffer.alloc(0), truncated: false };
  if (status < 200 || status >= 300 || !(robots || isHtml)) {
    response.destroy();
    return result;
  }

  const encoding = (response.headers['content-encoding'] || 'identity').trim().toLowerCase();
  if (encoding !== 'identity' && !Object.hasOwn(decoders, encoding)) {
    response.destroy();
    return { ...result, truncated: true };
  }

  const stream = encoding === 'identity' ? response : decoders[encoding]();
  if (stream !== response) {
    let wireBytes = 0;
    response.on('data', (chunk) => {
      wireBytes += chunk.length;
      if (wireBytes > maxBodyBytes) {
        result.truncated = true;
        stream.destroy();
        response.destroy();
      }
    });
    response.once('error', (error) => stream.destroy(error));
    response.pipe(stream);
  }

  const chunks = [];
  let size = 0;
  try {
    for await (const chunk of stream) {
      const buffer = chunk.subarray(0, maxBodyBytes - size);
      chunks.push(buffer);
      size += buffer.length;
      if (size === maxBodyBytes) {
        result.truncated ||= chunk.length > buffer.length;
        if (result.truncated) break;
      }
    }
  } catch (error) {
    if (!result.truncated) throw error;
  } finally {
    response.destroy();
  }
  return { ...result, body: Buffer.concat(chunks, size) };
}
