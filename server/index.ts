// Local HTTP server for the Astro Content Editor. Listens on 127.0.0.1 only.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync, statSync, realpathSync, mkdirSync, copyFileSync, writeFileSync, renameSync, readdirSync, chmodSync, unlinkSync } from 'node:fs';
import { join, dirname, extname, resolve, relative, basename, sep } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { structuredPatch } from 'diff';
import { loadModel, composeText, auditChange } from './core/document.ts';
import { flavorOf, type PMNode } from './core/markdown.ts';
import { isSafeFieldPath, type FieldChange } from './core/frontmatter.ts';
import {
  projectKind,
  listProjects,
  hideProject,
  hiddenProjects,
  unhideAll,
  savedSettings,
  effectiveSettings,
  saveSettings,
  getConfig,
  saveConfig,
  detectConfig,
  touchRecent,
  recentProjects,
  listFiles,
  contentPath,
  inside,
  insideReal,
  previewUrl,
  resolveProjectInput,
  BACKUP_DIR,
  type ProjectConfig,
} from './core/project.ts';
import * as dev from './core/devserver.ts';
import * as session from './core/session.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
// The built web app: <repo>/dist when run from source, <package>/dist when run from build/server.
const DIST = [join(HERE, '..', 'dist'), join(HERE, '..', '..', 'dist')].find((d) => existsSync(join(d, 'index.html'))) ?? join(HERE, '..', 'dist');
const HOST = '127.0.0.1';
export const APP_ID = 'goastro';

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function projectRoot(p: unknown): string {
  if (typeof p !== 'string' || !p.trim()) throw new HttpError(400, 'Project path is required');
  const abs = resolveProjectInput(p);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) throw new HttpError(404, `Folder not found: ${abs}`);
  const real = realpathSync(abs);
  if (dirname(real) === real || real === realpathSync(homedir())) throw new HttpError(400, 'Choose a project folder, not the whole disk or your home folder');
  if (!projectKind(real)) throw new HttpError(400, `No Markdown or MDX files found in ${real}`);
  return real;
}

const MAX_BODY = 10 * 1024 * 1024;
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Read a JSON body: at most 10 MB, and keys such as __proto__ are dropped (prototype pollution). */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, 'Request is too large');
    chunks.push(c as Buffer);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw, (k, v) => (UNSAFE_KEYS.has(k) ? undefined : v));
  } catch {
    throw new HttpError(400, 'Request body is not valid JSON');
  }
}

/** Headers on every response: no framing by other sites (clickjacking), no MIME sniffing. */
const BASE_HEADERS = {
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'content-security-policy': "frame-ancestors 'none'",
  'referrer-policy': 'no-referrer',
};

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { ...BASE_HEADERS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

/**
 * Only goastro's own page may call the API.
 * - Host must be 127.0.0.1:<port> or localhost:<port>. This stops DNS rebinding.
 * - A browser request must come from the same origin. This stops other websites (CSRF).
 * - Requests that change something must send JSON, which a plain HTML form or a "simple" request cannot.
 * Command-line clients (goastro stop) send no browser headers and pass.
 */
function checkRequest(req: IncomingMessage, url: URL) {
  const port = (server.address() as { port: number } | null)?.port;
  const host = (req.headers.host ?? '').toLowerCase();
  if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) throw new HttpError(403, 'Forbidden host');
  if (!url.pathname.startsWith('/api/')) return;
  // The API needs this run's token: the cookie set by the goastro link, or a header from the goastro command.
  // Only /api/ping is open, so the command can tell that goastro runs on this port.
  if (url.pathname !== '/api/ping') {
    const given = req.headers['x-goastro-token'] ?? session.cookieToken(req.headers.cookie, port!);
    if (!session.validToken(given)) throw new HttpError(401, 'goastro needs a fresh link. Run goastro in your terminal to open it again.');
  }
  const site = req.headers['sec-fetch-site'];
  if (site && site !== 'same-origin') throw new HttpError(403, 'Cross-site request refused');
  const origin = req.headers.origin;
  if (origin && origin !== `http://${host}`) throw new HttpError(403, 'Cross-origin request refused');
  if (req.method !== 'GET' && req.method !== 'HEAD' && !/^application\/json\s*(;|$)/i.test(req.headers['content-type'] ?? ''))
    throw new HttpError(415, 'Send JSON (content-type: application/json)');
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.svg']);

function sendFile(res: ServerResponse, file: string, extra: Record<string, string> = {}) {
  const data = readFileSync(file); // read first: a read error must not happen after the headers are sent
  res.writeHead(200, { ...BASE_HEADERS, 'content-type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', ...extra });
  res.end(data);
}

/** Project images are untrusted: an SVG may contain script. Serve them sandboxed. */
const ASSET_HEADERS = { 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox", 'cache-control': 'no-store' };

/** Write a file atomically through a random, exclusive temp file. Keeps the file mode. */
function writeAtomic(abs: string, text: string) {
  const tmp = join(dirname(abs), `.${basename(abs)}.${randomBytes(6).toString('hex')}.goastro-tmp`);
  const mode = statSync(abs).mode & 0o7777;
  if (process.platform !== 'win32' && (mode & 0o222) === 0) throw new HttpError(403, 'This file is read-only. Make it writable to save it.');
  try {
    writeFileSync(tmp, text, { flag: 'wx', mode }); // wx: fails if the name exists, never follows a symlink
    chmodSync(tmp, mode);
    renameSync(tmp, abs);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      // nothing to clean up
    }
    throw e;
  }
}

function loadDoc(root: string, rel: string) {
  const config = getConfig(root);
  let found;
  try {
    found = contentPath(root, config, rel);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
  const { abs, collection } = found;
  if (!existsSync(abs)) throw new HttpError(404, 'File not found');
  const text = readFileSync(abs, 'utf8');
  return { config, collection, abs, text };
}

function diffHunks(oldText: string, newText: string, name: string) {
  return structuredPatch(name, name, oldText, newText, '', '', { context: 3 }).hunks;
}

/** Copy the current file to the backup folder before overwriting it. */
function backup(root: string, abs: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dest = join(BACKUP_DIR, basename(root), stamp, relative(root, abs));
  mkdirSync(dirname(dest), { recursive: true, mode: 0o700 }); // backups are private
  copyFileSync(abs, dest);
  chmodSync(dest, 0o600);
  return dest;
}

function listImages(root: string): string[] {
  const pub = join(root, 'public');
  const out: string[] = [];
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length > 3000 || e.name.startsWith('.')) continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (IMAGE_EXT.has(extname(e.name).toLowerCase())) out.push('/' + relative(pub, p).split(sep).join('/'));
    }
  };
  walk(pub);
  return out.sort();
}

async function checkDevServer(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500), redirect: 'manual' });
    return r.status > 0;
  } catch {
    return false;
  }
}

async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL) {
  const q = url.searchParams;
  const route = `${req.method} ${url.pathname}`;
  switch (route) {
    case 'POST /api/heartbeat':
      dev.heartbeat(); // a goastro tab is open
      return send(res, 200, { ok: true });

    case 'GET /api/ping':
      return send(res, 200, { app: APP_ID });

    case 'POST /api/shutdown': {
      // A custom header forces a CORS preflight, so other web pages cannot call this.
      if (req.headers['x-goastro'] !== 'stop') throw new HttpError(403, 'Missing x-goastro header');
      send(res, 200, { ok: true });
      setTimeout(shutdown, 50);
      return;
    }

    case 'GET /api/recent':
      return send(res, 200, { recent: recentProjects() });

    case 'GET /api/projects':
      return send(res, 200, { projects: listProjects(), home: homedir() });

    case 'POST /api/projects/hide': {
      const body = await readJson(req);
      if (typeof body.root !== 'string' || !body.root) throw new HttpError(400, 'Project path is required');
      hideProject(body.root);
      return send(res, 200, { ok: true });
    }

    case 'POST /api/projects/unhide-all':
      unhideAll();
      return send(res, 200, { ok: true });

    case 'GET /api/settings': {
      const { overridden, ...effective } = effectiveSettings();
      return send(res, 200, { saved: savedSettings(), effective, overridden, hidden: hiddenProjects().length, runningPort: (server.address() as { port: number } | null)?.port ?? null });
    }

    case 'PUT /api/settings': {
      const body = await readJson(req);
      try {
        return send(res, 200, { saved: saveSettings(body as Record<string, never>) });
      } catch (e) {
        throw new HttpError(400, (e as Error).message);
      }
    }

    case 'POST /api/open': {
      const body = await readJson(req);
      // A ticket comes from a link that the goastro command opened. A plain path comes from your click in the app.
      const fromTicket = body.ticket !== undefined ? session.useTicket(body.ticket) : null;
      if (body.ticket !== undefined && !fromTicket) throw new HttpError(410, 'This link has expired. Run goastro again, or choose the project on the home page.');
      const root = projectRoot(fromTicket ?? body.root);
      touchRecent(root);
      await dev.stopOthers(root); // switching projects stops the other projects' dev servers
      return send(res, 200, { root, kind: projectKind(root), config: getConfig(root) });
    }

    case 'GET /api/config':
      return send(res, 200, getConfig(projectRoot(q.get('root'))));

    case 'PUT /api/config': {
      const body = await readJson(req);
      const root = projectRoot(body.root);
      const config = body.config as ProjectConfig;
      if (!config || !Array.isArray(config.collections)) throw new HttpError(400, 'Invalid settings');
      try {
        const u = new URL(String(config.devServerUrl));
        if (!/^https?:$/.test(u.protocol)) throw new Error();
      } catch {
        throw new HttpError(400, 'The dev server address must be a full http:// address, such as http://localhost:4321');
      }
      for (const c of config.collections) {
        try {
          insideReal(root, String(c.dir)); // reject folders outside the project
        } catch (e) {
          throw new HttpError(400, `${c.name}: ${(e as Error).message}`);
        }
        for (const f of c.fields ?? []) if (!isSafeFieldPath(String(f.key).split('.'))) throw new HttpError(400, `Invalid field key: ${f.key}`);
      }
      saveConfig(root, config);
      return send(res, 200, { ok: true });
    }

    case 'POST /api/detect': {
      const body = await readJson(req);
      return send(res, 200, detectConfig(projectRoot(body.root)));
    }

    case 'GET /api/files': {
      const root = projectRoot(q.get('root'));
      return send(res, 200, { collections: listFiles(root, getConfig(root)) });
    }

    case 'GET /api/doc': {
      const root = projectRoot(q.get('root'));
      const rel = q.get('path') ?? '';
      const { config, collection, text } = loadDoc(root, rel);
      const model = loadModel(text, flavorOf(rel));
      const id = relative(inside(root, collection.dir), inside(root, rel)).replace(/\.(md|mdx)$/i, '').split(sep).join('/');
      return send(res, 200, {
        path: rel,
        text,
        hash: sha(text),
        model,
        collection: collection.name,
        fields: collection.fields,
        previewUrl: previewUrl(config, collection, id, model.frontmatter),
      });
    }

    case 'POST /api/parse': {
      const body = await readJson(req);
      return send(res, 200, { model: loadModel(String(body.text ?? ''), flavorOf(String(body.path ?? ''))) });
    }

    case 'POST /api/compose': {
      const body = await readJson(req);
      const root = projectRoot(body.root);
      const rel = String(body.path ?? '');
      const { text: diskText } = loadDoc(root, rel);
      const flavor = flavorOf(rel);
      let newText: string;
      let changedFields: string[] = [];
      if (typeof body.sourceText === 'string') {
        newText = body.sourceText;
      } else {
        if (body.fields !== undefined && (!Array.isArray(body.fields) || !body.fields.every((f: FieldChange) => f && isSafeFieldPath(f.path))))
          throw new HttpError(400, 'Invalid field names');
        const r = composeText(String(body.baseText ?? diskText), flavor, {
          nodes: body.nodes as PMNode[] | undefined,
          fields: body.fields as FieldChange[] | undefined,
        });
        newText = r.text;
        changedFields = r.changedFields;
      }
      return send(res, 200, {
        newText,
        changed: newText !== diskText,
        diskChanged: typeof body.diskHash === 'string' && body.diskHash !== sha(diskText),
        changedFields,
        audit: auditChange(diskText, newText, flavor),
        hunks: diffHunks(diskText, newText, rel),
      });
    }

    case 'POST /api/save': {
      const body = await readJson(req);
      const root = projectRoot(body.root);
      const rel = String(body.path ?? '');
      const { abs, text: diskText } = loadDoc(root, rel);
      if (body.diskHash !== sha(diskText))
        throw new HttpError(409, 'The file changed on disk after you opened it. Reload it before saving.');
      const newText = String(body.newText ?? '');
      if (newText === diskText) return send(res, 200, { hash: sha(diskText), saved: false });
      const audit = auditChange(diskText, newText, flavorOf(rel));
      const risky = audit.missing.length > 0 || audit.parseError || audit.frontmatterError;
      if (risky && body.confirmWarnings !== true)
        throw new HttpError(409, 'This change removes protected content or has errors. Confirm the warnings to save.');
      const backupPath = backup(root, abs);
      writeAtomic(abs, newText);
      return send(res, 200, { hash: sha(newText), saved: true, backupPath });
    }

    case 'GET /api/asset': {
      const root = projectRoot(q.get('root'));
      const src = (q.get('src') ?? '').split(/[?#]/)[0]; // searchParams already decoded it
      const rel = q.get('path') ?? '';
      const candidates = src.startsWith('/')
        ? [join('public', src), src.slice(1)]
        : [join(dirname(rel), src), join('src', src.replace(/^[~@]\//, ''))];
      for (const c of candidates) {
        let file: string;
        try {
          file = insideReal(root, c); // also refuses symlinks that point outside the project
        } catch {
          continue;
        }
        if (existsSync(file) && statSync(file).isFile() && IMAGE_EXT.has(extname(file).toLowerCase())) return sendFile(res, file, ASSET_HEADERS);
      }
      throw new HttpError(404, 'Image not found');
    }

    case 'GET /api/images':
      return send(res, 200, { images: listImages(projectRoot(q.get('root'))) });

    case 'GET /api/dev': {
      // Is a dev server available for this project? Ours ("managed") or one you started ("external").
      const root = projectRoot(q.get('root'));
      dev.touch(root);
      const managed = dev.status(root);
      const canStart = dev.canStart(root);
      if (managed && managed.state !== 'exited') return send(res, 200, { managed, external: false, canStart });
      const configured = getConfig(root).devServerUrl.replace(/\/?$/, '/');
      const otherProject = dev.list().some((d) => d.root !== root && d.url && new URL(d.url).port === new URL(configured).port);
      const external = !otherProject && (await checkDevServer(configured));
      return send(res, 200, { managed, external, canStart });
    }

    case 'POST /api/dev/start': {
      const body = await readJson(req);
      const root = projectRoot(body.root);
      if (!dev.canStart(root)) throw new HttpError(400, 'This project has no "dev" script in package.json. Start its dev server yourself.');
      await dev.stopOthers(root);
      return send(res, 200, { managed: await dev.start(root) });
    }

    case 'POST /api/dev/stop': {
      const body = await readJson(req);
      await dev.stop(projectRoot(body.root));
      return send(res, 200, { ok: true });
    }
  }
  throw new HttpError(404, 'Unknown API route');
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  try {
    checkRequest(req, url);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    // The link from the goastro command: ?token=…[&project=…]. Swap the token for a cookie, and the
    // project for a one-time ticket, then load the page without them in the address.
    if (url.searchParams.has('token')) {
      const port = (server.address() as { port: number }).port;
      const headers: Record<string, string> = { ...BASE_HEADERS, 'cache-control': 'no-store' };
      let next = '/';
      if (session.validToken(url.searchParams.get('token'))) {
        headers['set-cookie'] = `${session.cookieName(port)}=${url.searchParams.get('token')}; HttpOnly; SameSite=Strict; Path=/`;
        const project = url.searchParams.get('project');
        if (project) next = `/?open=${session.createTicket(project)}`;
      }
      res.writeHead(302, { ...headers, location: next });
      return res.end();
    }
    if (!existsSync(DIST)) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      return res.end('The web app is not built. Run "npm run build" in the goastro folder first.');
    }
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      throw new HttpError(400, 'Bad address');
    }
    const file = inside(DIST, '.' + pathname);
    if (existsSync(file) && statSync(file).isFile()) return sendFile(res, file);
    return sendFile(res, join(DIST, 'index.html'));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (res.headersSent) return res.destroy();
    send(res, status, { error: (e as Error).message });
  }
});

/** Stop all dev servers that the editor started, then exit. Used by "goastro stop". */
async function shutdown() {
  console.log('Stopping (goastro stop)…');
  await dev.stopOthers(null);
  server.close();
  process.exit(0);
}

/** Close the server (tests). */
export function closeServer(): Promise<void> {
  return new Promise((done) => {
    server.closeAllConnections?.();
    server.close(() => done());
  });
}

/** Start the editor. Resolves when it listens. */
/** Start goastro. Resolves with its address and this run's access token. */
export function startServer(port: number): Promise<{ url: string; token: string }> {
  dev.installCleanup();
  return new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, HOST, () => {
      const actual = (server.address() as { port: number }).port;
      done({ url: `http://${HOST}:${actual}/`, token: session.createSession(actual) });
    });
  });
}
