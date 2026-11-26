// Access control for the local API.
//
// Every run of goastro creates a random token. It is written to a file that only you can read
// (~/.local/state/goastro/session-<port>.json, mode 0600). The goastro command reads it and opens
// the browser with ?token=…; the server swaps the token for an HttpOnly, SameSite=Strict cookie.
// API requests need that cookie, or the token in an x-goastro-token header (goastro stop).
// So other programs and other users on the same computer cannot use the API.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { STATE_DIR } from './paths.ts';

const sessionFile = (port: number) => join(STATE_DIR, `session-${port}.json`);

let token = '';
let file = '';

/** Create this run's token and save it for the goastro command. Removed again on exit. */
export function createSession(port: number): string {
  token = randomBytes(32).toString('hex');
  file = sessionFile(port);
  mkdirSync(STATE_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify({ pid: process.pid, port, token }), { flag: 'wx', mode: 0o600 });
  renameSync(tmp, file);
  process.on('exit', removeSession);
  return token;
}

export function removeSession() {
  if (!file) return;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    if (saved.pid === process.pid) unlinkSync(file); // never remove a newer goastro's file
  } catch {
    // already gone
  }
}

/** The token of the goastro running on `port`, for the command line. Null if unknown (older version). */
export function readSessionToken(port: number): string | null {
  try {
    const saved = JSON.parse(readFileSync(sessionFile(port), 'utf8'));
    return typeof saved.token === 'string' ? saved.token : null;
  } catch {
    return null;
  }
}

/** Constant-time check against this run's token. */
export function validToken(candidate: unknown): boolean {
  if (!token || typeof candidate !== 'string' || candidate.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(token));
}

export const cookieName = (port: number) => `goastro_${port}`;

export function cookieToken(header: string | undefined, port: number): string | null {
  const name = cookieName(port);
  for (const part of (header ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

// ---------- one-time open tickets ----------
// The goastro command opens /?token=…&project=…. The server turns that into /?open=<ticket>, so the page
// can open the project once. A plain /?project= link (for example from another website) only asks.

const tickets = new Map<string, { root: string; expires: number }>();

export function createTicket(root: string): string {
  const t = randomBytes(16).toString('hex');
  tickets.set(t, { root, expires: Date.now() + 60_000 });
  return t;
}

export function useTicket(t: unknown): string | null {
  if (typeof t !== 'string') return null;
  const entry = tickets.get(t);
  tickets.delete(t);
  return entry && entry.expires > Date.now() ? entry.root : null;
}
