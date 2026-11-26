// The HTTP API refuses other websites, DNS rebinding, prototype pollution and symlink escapes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { request } from 'node:http';

const TMP = realpathSync(mkdtempSync(join(tmpdir(), 'goastro-srv-')));
process.env.GOASTRO_CONFIG_DIR = join(TMP, 'config');
process.env.GOASTRO_STATE_DIR = join(TMP, 'state');
const { startServer, closeServer } = await import('../server/index.ts');

const ROOT = join(TMP, 'site');
const OUTSIDE = join(TMP, 'outside');
let port = 0;
let token = '';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

before(async () => {
  mkdirSync(join(ROOT, 'src/content/blog'), { recursive: true });
  mkdirSync(join(ROOT, 'public'), { recursive: true });
  mkdirSync(OUTSIDE, { recursive: true });
  writeFileSync(join(ROOT, 'astro.config.mjs'), 'export default {}');
  writeFileSync(join(ROOT, 'src/content/blog/a.md'), '---\ntitle: A\n---\n\nHello.\n');
  writeFileSync(join(OUTSIDE, 'secret.md'), 'secret');
  writeFileSync(join(OUTSIDE, 'secret.png'), 'png');
  symlinkSync(join(OUTSIDE, 'secret.md'), join(ROOT, 'src/content/blog/link.md'));
  symlinkSync(join(OUTSIDE, 'secret.png'), join(ROOT, 'public/link.png'));
  writeFileSync(join(ROOT, 'public/x.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const started = await startServer(0);
  port = Number(new URL(started.url).port);
  token = started.token;
});

after(() => closeServer());

/** Raw request, so tests can set any Host or Origin header. */
function call(method: string, path: string, opts: { headers?: Record<string, string>; body?: string; noToken?: boolean } = {}) {
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>((done, fail) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers: { host: `127.0.0.1:${port}`, ...(opts.noToken ? {} : { 'x-goastro-token': token }), ...opts.headers } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => done({ status: res.statusCode!, headers: res.headers, body }));
    });
    req.on('error', fail);
    req.end(opts.body);
  });
}
const json = { 'content-type': 'application/json' };
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

test('a foreign Host header is refused (DNS rebinding)', async () => {
  assert.equal((await call('GET', '/api/projects', { headers: { host: `attacker.example:${port}` } })).status, 403);
  assert.equal((await call('GET', '/', { headers: { host: `attacker.example:${port}` } })).status, 403);
  assert.equal((await call('GET', '/api/ping')).status, 200);
});

test('other websites cannot call the API (CSRF)', async () => {
  const body = JSON.stringify({ root: ROOT });
  assert.equal((await call('POST', '/api/open', { headers: { 'content-type': 'text/plain' }, body })).status, 415, 'simple request');
  assert.equal((await call('POST', '/api/open', { headers: { ...json, origin: 'https://evil.example' }, body })).status, 403, 'foreign origin');
  assert.equal((await call('POST', '/api/open', { headers: { ...json, 'sec-fetch-site': 'cross-site' }, body })).status, 403, 'cross-site');
  assert.equal((await call('GET', `/api/asset?${q({ root: ROOT, src: '/x.svg' })}`, { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403, 'navigation from another site');
  assert.equal((await call('POST', '/api/open', { headers: { ...json, origin: `http://127.0.0.1:${port}`, 'sec-fetch-site': 'same-origin' }, body })).status, 200, 'own page');
});

test('field names cannot pollute Object.prototype', async () => {
  const body = JSON.stringify({ root: ROOT, path: 'src/content/blog/a.md', nodes: [], fields: [{ path: ['__proto__', 'polluted'], value: 'yes' }] });
  const r = await call('POST', '/api/compose', { headers: json, body });
  assert.equal(r.status, 400);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
  const raw = '{"root":"' + ROOT + '","path":"src/content/blog/a.md","__proto__":{"sourceText":"evil"}}';
  await call('POST', '/api/compose', { headers: json, body: raw });
  assert.equal(({} as Record<string, unknown>).sourceText, undefined);
});

test('symlinks cannot read files outside the project', async () => {
  const doc = await call('GET', `/api/doc?${q({ root: ROOT, path: 'src/content/blog/link.md' })}`);
  assert.equal(doc.status, 400);
  assert.ok(!doc.body.includes('secret'));
  assert.equal((await call('GET', `/api/asset?${q({ root: ROOT, src: '/link.png' })}`)).status, 404);
});

test('project images are sandboxed, and pages cannot be framed', async () => {
  const svg = await call('GET', `/api/asset?${q({ root: ROOT, src: '/x.svg' })}`);
  assert.equal(svg.status, 200);
  assert.match(String(svg.headers['content-security-policy']), /sandbox/);
  assert.equal(svg.headers['x-content-type-options'], 'nosniff');
  const page = await call('GET', '/');
  assert.match(String(page.headers['content-security-policy']), /frame-ancestors 'none'/);
});

test('save writes through an exclusive temp file and keeps the content', async () => {
  const path = 'src/content/blog/a.md';
  const text = readFileSync(join(ROOT, path), 'utf8');
  // A planted file with the old fixed temp name must not be followed.
  symlinkSync(join(OUTSIDE, 'secret.md'), join(ROOT, 'src/content/blog/.a.md.ace-tmp'));
  const newText = text.replace('Hello.', 'Hello again.');
  const r = await call('POST', '/api/save', { headers: json, body: JSON.stringify({ root: ROOT, path, diskHash: sha(text), newText }) });
  assert.equal(r.status, 200, r.body);
  assert.equal(readFileSync(join(ROOT, path), 'utf8'), newText);
  assert.equal(readFileSync(join(OUTSIDE, 'secret.md'), 'utf8'), 'secret');
});

test('an invalid dev server address is refused', async () => {
  const config = { devServerUrl: 'not a url', collections: [] };
  const r = await call('PUT', '/api/config', { headers: json, body: JSON.stringify({ root: ROOT, config }) });
  assert.equal(r.status, 400);
});

test('the API needs this run\'s token (other local programs and users are refused)', async () => {
  assert.equal((await call('GET', '/api/projects', { noToken: true })).status, 401);
  assert.equal((await call('GET', '/api/projects', { noToken: true, headers: { 'x-goastro-token': 'x'.repeat(64) } })).status, 401);
  assert.equal((await call('GET', '/api/ping', { noToken: true })).status, 200, 'ping stays open for the goastro command');
  assert.equal((await call('GET', '/api/projects')).status, 200);
});

test('the goastro link swaps the token for a cookie and the project for a one-time ticket', async () => {
  const r = await call('GET', `/?${q({ token, project: ROOT })}`, { noToken: true });
  assert.equal(r.status, 302);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  assert.match(String(r.headers['set-cookie']), /HttpOnly; SameSite=Strict/);
  const ticket = new URL(String(r.headers.location), 'http://x').searchParams.get('open')!;
  assert.ok(ticket);
  const open = (h: Record<string, string>) => call('POST', '/api/open', { noToken: true, headers: { ...json, cookie, ...h }, body: JSON.stringify({ ticket }) });
  assert.equal((await open({})).status, 200, 'the cookie works and the ticket opens the project');
  assert.equal((await open({})).status, 410, 'a ticket works only once');
  const bad = await call('GET', `/?${q({ token: 'wrong', project: ROOT })}`, { noToken: true });
  assert.equal(bad.status, 302);
  assert.equal(bad.headers['set-cookie'], undefined, 'a wrong token gets no cookie');
});
