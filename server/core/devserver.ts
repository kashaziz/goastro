// Dev servers that goastro starts for Preview, and the cleanup that stops them.
//
// Rules:
// - goastro only stops dev servers that it started itself. A dev server you start by hand is never touched.
// - Each dev server runs in its own process group, so a stop also ends Astro's child processes.
//   (On Windows, `taskkill /T` stops the process tree.)
// - All dev servers stop when goastro exits, when you switch projects, and after the idle time without Preview use.
// - A PID file records each dev server, with the goastro process that owns it and the dev server's start time.
//   If goastro is killed hard (kill -9), the next start stops the leftovers. A reused PID is never stopped,
//   and the dev servers of another running goastro are left alone.
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { STATE_DIR } from './paths.ts';
import { effectiveSettings } from './project.ts';

/** Idle time from settings (or GOASTRO_DEV_IDLE_MINUTES), read each time so a settings change applies at once. */
const idleMs = () => effectiveSettings().idleMinutes * 60_000;
const PID_FILE = join(STATE_DIR, 'dev-servers.json');
const LOG_LINES = 40;
const WIN = process.platform === 'win32';

export type DevState = 'starting' | 'running' | 'exited';

interface Managed {
  root: string;
  child: ChildProcess;
  pid: number;
  port: number;
  url: string | null; // the URL that the dev server prints
  state: DevState;
  log: string[];
  lastUsed: number;
  startedAt: string;
  procStart: string | null; // start time of the process, to tell it apart from a later process with the same PID
  exitCode: number | null;
}

export interface DevInfo {
  root: string;
  pid: number;
  url: string | null;
  state: DevState;
  log: string[];
  exitCode: number | null;
}

interface PidRecord {
  pid: number;
  owner?: number; // PID of the goastro process that started it
  ownerStart?: string | null; // its start time, so a reused PID is not taken for it
  root: string;
  port: number;
  startedAt: string;
  procStart?: string | null;
}

const servers = new Map<string, Managed>();
let SELF_START: string | null = null; // set on first use: processStart(process.pid)
const starting = new Map<string, Promise<DevInfo>>();

const info = (m: Managed): DevInfo => ({ root: m.root, pid: m.pid, url: m.url, state: m.state, log: m.log.slice(-LOG_LINES), exitCode: m.exitCode });

// ---------- processes ----------

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A value that changes when a PID is reused: the process start time (Linux: /proc, macOS: ps). */
function processStart(pid: number): string | null {
  try {
    if (existsSync(`/proc/${pid}/stat`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19] ?? null; // field 22: start time in clock ticks
    }
    if (!WIN) return execFileSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' }).trim() || null;
  } catch {
    // process gone
  }
  return null;
}

/** True if `pid` leads its own process group, as the dev servers goastro starts do. */
function leadsGroup(pid: number): boolean {
  try {
    if (existsSync(`/proc/${pid}/stat`)) {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      return Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[2]) === pid; // field 5: process group
    }
    if (!WIN) return Number(execFileSync('ps', ['-o', 'pgid=', '-p', String(pid)], { encoding: 'utf8' }).trim()) === pid;
  } catch {
    // process gone
  }
  return false;
}

const groupAlive = (pid: number) => {
  try {
    process.kill(WIN ? pid : -pid, 0);
    return true;
  } catch {
    return false;
  }
};

function killGroup(pid: number, signal: NodeJS.Signals) {
  try {
    if (WIN) execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-pid, signal); // negative PID = the whole process group
  } catch {
    // already gone
  }
}

// ---------- PID file ----------

function readPids(): PidRecord[] {
  try {
    const list = JSON.parse(readFileSync(PID_FILE, 'utf8'));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

/** Save our dev servers, and keep the records of other goastro processes that are still running. */
function writePids() {
  SELF_START ??= processStart(process.pid);
  const others = readPids().filter((r) => r.owner && r.owner !== process.pid && ownerAlive(r));
  const ours: PidRecord[] = [...servers.values()]
    .filter((m) => m.state !== 'exited')
    .map((m) => ({ pid: m.pid, owner: process.pid, ownerStart: SELF_START, root: m.root, port: m.port, startedAt: m.startedAt, procStart: m.procStart }));
  try {
    mkdirSync(dirname(PID_FILE), { recursive: true });
    const tmp = `${PID_FILE}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, JSON.stringify([...others, ...ours], null, 2), { flag: 'wx', mode: 0o600 });
    renameSync(tmp, PID_FILE);
  } catch {
    // The PID file is a safety net only.
  }
}

/** True if the record is a dev server that a goastro process which has since died left behind. */
function ownerAlive(rec: PidRecord): boolean {
  if (!rec.owner || !alive(rec.owner)) return false;
  return !rec.ownerStart || processStart(rec.owner) === rec.ownerStart; // same process, not a reused PID
}

function isLeftover(rec: PidRecord): boolean {
  if (ownerAlive(rec)) return false; // its goastro still runs and manages it
  if (!alive(rec.pid) || !leadsGroup(rec.pid)) return false;
  if (rec.procStart) return processStart(rec.pid) === rec.procStart;
  // Older records without a start time: compare the working folder (Linux only).
  try {
    return existsSync(`/proc/${rec.pid}/cwd`) && realpathSync(`/proc/${rec.pid}/cwd`) === rec.root;
  } catch {
    return false;
  }
}

/** Stop dev servers left over from a goastro that did not exit cleanly. Returns how many it stopped. */
export function sweepLeftovers(): number {
  let n = 0;
  for (const rec of readPids()) {
    if (isLeftover(rec)) {
      killGroup(rec.pid, 'SIGTERM');
      // Children that ignore SIGTERM: force them a moment later (the group keeps its ID while any member lives).
      setTimeout(() => {
        if (groupAlive(rec.pid)) killGroup(rec.pid, 'SIGKILL');
      }, 3000).unref();
      n++;
    }
  }
  writePids();
  return n;
}

// ---------- ports and output ----------

function portFree(port: number): Promise<boolean> {
  const tryHost = (host: string) =>
    new Promise<boolean>((done) => {
      const s = createServer();
      s.once('error', (e: NodeJS.ErrnoException) => done(e.code === 'EADDRNOTAVAIL' || e.code === 'EAFNOSUPPORT'));
      s.listen(port, host, () => s.close(() => done(true)));
    });
  return tryHost('127.0.0.1').then((a) => (a ? tryHost('::1') : false));
}

export async function freePort(from = 4321): Promise<number> {
  for (let p = from; p < from + 100; p++) if (await portFree(p)) return p;
  throw new Error(`No free port from ${from} to ${from + 99}`);
}

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g;
/** Find the local URL in a line of dev server output, for example "Local    http://localhost:4321/". */
export function findLocalUrl(text: string): string | null {
  const m = text.replace(ANSI, '').match(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]):\d+\/?/);
  return m ? m[0].replace(/\/?$/, '/') : null;
}

/** Poll the dev server until it answers an HTTP request, then mark it running (at most 60 s). */
async function waitUntilAnswers(m: Managed) {
  const end = Date.now() + 60_000;
  while (m.state === 'starting' && Date.now() < end) {
    try {
      await fetch(m.url!, { signal: AbortSignal.timeout(2000), redirect: 'manual' });
      if (m.state === 'starting') m.state = 'running';
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  if (m.state === 'starting') m.state = 'running'; // let the browser try; Reload is there
}

// ---------- start, stop, status ----------

export function status(root: string): DevInfo | null {
  const m = servers.get(root);
  return m ? info(m) : null;
}

export function touch(root: string) {
  const m = servers.get(root);
  if (m) m.lastUsed = Date.now();
}

export function list(): DevInfo[] {
  return [...servers.values()].filter((m) => m.state !== 'exited').map(info);
}

/** True if the project has a "dev" script in package.json, so goastro can start a dev server. */
export function canStart(root: string): boolean {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return typeof pkg.scripts?.dev === 'string';
  } catch {
    return false;
  }
}

/**
 * Start `npm run dev -- --port <free port>` in `root`. A second call while one is starting or running
 * returns the same dev server. `command` is for tests only.
 */
export function start(root: string, command?: { cmd: string; args: string[] }): Promise<DevInfo> {
  const existing = servers.get(root);
  if (existing && existing.state !== 'exited') {
    existing.lastUsed = Date.now();
    return Promise.resolve(info(existing));
  }
  const pending = starting.get(root);
  if (pending) return pending;
  const p = spawnDev(root, command).finally(() => starting.delete(root));
  starting.set(root, p);
  return p;
}

async function spawnDev(root: string, command?: { cmd: string; args: string[] }): Promise<DevInfo> {
  const port = await freePort();
  // On Windows npm is a .cmd file, which Node runs only through a shell. The arguments are fixed and the port is a number.
  const run = command ?? { cmd: 'npm', args: ['run', 'dev', '--', '--port', String(port)] };
  const viaShell = WIN && !command;
  const child = spawn(viaShell ? `npm run dev -- --port ${port}` : run.cmd, viaShell ? [] : run.args, {
    cwd: root,
    detached: !WIN, // own process group, so we can stop all of it
    shell: viaShell,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1', BROWSER: 'none' },
  });
  // Wait for the spawn to succeed or fail. A missing npm must not crash goastro.
  const failed = await new Promise<Error | null>((done) => {
    child.once('spawn', () => done(null));
    child.once('error', (e) => done(e));
  });
  if (failed || !child.pid) throw new Error(`Could not start the dev server: ${failed?.message ?? 'no process'}`);

  const m: Managed = {
    root,
    child,
    pid: child.pid,
    port,
    url: null,
    state: 'starting',
    log: [],
    lastUsed: Date.now(),
    startedAt: new Date().toISOString(),
    procStart: processStart(child.pid),
    exitCode: null,
  };
  servers.set(root, m);
  writePids();

  // Read output line by line, so an address split across two chunks is still found.
  const reader = () => {
    let partial = '';
    return (buf: Buffer) => {
      const lines = (partial + buf.toString('utf8')).split('\n');
      partial = lines.pop() ?? '';
      for (const raw of lines) {
        const line = raw.replace(ANSI, '').trimEnd();
        if (!line.trim()) continue;
        m.log.push(line);
        if (!m.url) {
          const url = findLocalUrl(line);
          if (url) {
            m.url = url;
            void waitUntilAnswers(m); // "running" only once the page answers a request
          }
        }
      }
      if (m.log.length > 200) m.log.splice(0, m.log.length - 200);
    };
  };
  child.stdout?.on('data', reader());
  child.stderr?.on('data', reader());
  child.on('exit', (code) => {
    m.state = 'exited';
    m.exitCode = code;
    writePids();
  });
  child.on('error', (e) => {
    m.log.push(`Error: ${e.message}`);
    m.state = 'exited';
    writePids();
  });
  return info(m);
}

/** Stop one dev server and wait until it has exited (force after 5 seconds). */
export async function stop(root: string): Promise<void> {
  await starting.get(root)?.catch(() => null); // let a start in progress finish, then stop it
  const m = servers.get(root);
  if (!m) return;
  servers.delete(root);
  if (m.state !== 'exited') {
    const exited = new Promise<void>((done) => {
      if (m.child.exitCode !== null || m.child.signalCode !== null) return done();
      m.child.once('exit', () => done());
    });
    killGroup(m.pid, 'SIGTERM');
    const timer = setTimeout(() => killGroup(m.pid, 'SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    if (groupAlive(m.pid)) killGroup(m.pid, 'SIGKILL'); // children that ignored SIGTERM
  }
  writePids();
}

/** Stop every dev server except the one for `keep`. */
export async function stopOthers(keep: string | null) {
  const roots = new Set([...servers.keys(), ...starting.keys()]);
  await Promise.all([...roots].filter((r) => r !== keep).map((r) => stop(r)));
}

/** Synchronous stop for process exit. Cannot wait, so it sends SIGTERM and then SIGKILL. */
export function stopAllNow() {
  for (const m of servers.values()) {
    if (m.state === 'exited') continue;
    killGroup(m.pid, 'SIGTERM');
    if (!WIN && groupAlive(m.pid)) killGroup(m.pid, 'SIGKILL');
  }
  servers.clear();
  writePids();
}

let cleanupInstalled = false;
/** Stop dev servers on exit and on idle. Call once when goastro starts. */
export function installCleanup() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const leftovers = sweepLeftovers();
  if (leftovers) console.log(`Stopped ${leftovers} dev server(s) left over from an earlier run.`);

  process.on('exit', stopAllNow);
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) {
    process.on(sig, () => {
      stopAllNow();
      process.exit(sig === 'SIGINT' ? 130 : 143);
    });
  }
  process.on('uncaughtException', (e) => {
    console.error(e);
    stopAllNow();
    process.exit(1);
  });

  const timer = setInterval(() => checkIdle(), 30_000);
  timer.unref();
}

// ---------- idle rules ----------

/** Stop the dev servers when no goastro tab has been heard from for this long (tabs send a heartbeat every 30 s). */
export const NO_TAB_MS = 3 * 60_000;
let lastSeen = Date.now();

/** A goastro tab is open. */
export function heartbeat(at = Date.now()) {
  lastSeen = at;
}

/**
 * Stop dev servers that nobody uses:
 * - all of them when no goastro tab is open (no heartbeat for NO_TAB_MS),
 * - one whose Preview has not been used for the idle time from settings (30 minutes by default).
 */
export function checkIdle(now = Date.now()) {
  const noTab = now - lastSeen > NO_TAB_MS;
  for (const m of [...servers.values()]) {
    if (m.state === 'exited') servers.delete(m.root);
    else if (noTab) {
      console.log(`No goastro tab is open. Stopping the dev server for ${m.root}`);
      void stop(m.root);
    } else if (now - m.lastUsed > idleMs()) {
      console.log(`Stopping the idle dev server for ${m.root}`);
      void stop(m.root);
    }
  }
}
