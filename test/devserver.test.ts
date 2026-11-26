// Dev server housekeeping: the editor must never leave dev servers running.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';

const STATE = mkdtempSync(join(tmpdir(), 'ace-dev-'));
process.env.ACE_STATE_DIR = STATE;
const dev = await import('../server/core/devserver.ts');

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, ms = 5000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (fn()) return true;
    await wait(50);
  }
  return false;
}

// A fake dev server: starts a grandchild process and writes its PID, then serves HTTP and prints its URL like Astro.
const SERVE = `require('http').createServer((q, r) => r.end('ok')).listen(0, '127.0.0.1', function () { console.log('  Local    http://localhost:' + this.address().port + '/'); })`;
const fakeDev = (pidFile: string) => ({
  cmd: 'sh',
  args: ['-c', `sleep 60 & echo $! > ${pidFile}; ${JSON.stringify(process.execPath)} -e ${JSON.stringify(SERVE)} & wait`],
});

before(() => writeFileSync(join(STATE, 'dev-servers.json'), '[]'));

test('findLocalUrl reads the URL that Astro prints', () => {
  assert.equal(dev.findLocalUrl('\x1b[32m┃ Local    http://localhost:4322/\x1b[39m'), 'http://localhost:4322/');
  assert.equal(dev.findLocalUrl('ready http://127.0.0.1:4321'), 'http://127.0.0.1:4321/');
  assert.equal(dev.findLocalUrl('building...'), null);
});

test('start waits until the page answers, and stop ends the whole process group', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  const pidFile = join(root, 'grandchild.pid');
  const info = await dev.start(root, fakeDev(pidFile));
  assert.ok(await until(() => dev.status(root)?.state === 'running'), 'dev server did not answer');
  assert.match(dev.status(root)?.url ?? '', /^http:\/\/localhost:\d+\/$/);
  const grandchild = Number(readFileSync(pidFile, 'utf8'));
  assert.ok(alive(info.pid) && alive(grandchild));

  const recorded = JSON.parse(readFileSync(join(STATE, 'dev-servers.json'), 'utf8'));
  assert.deepEqual(recorded.map((r: { pid: number }) => r.pid), [info.pid]);

  await dev.stop(root);
  assert.ok(await until(() => !alive(info.pid) && !alive(grandchild)), 'processes still running after stop');
  assert.equal(dev.status(root), null);
  assert.deepEqual(JSON.parse(readFileSync(join(STATE, 'dev-servers.json'), 'utf8')), []);
});

test('starting twice for one project reuses the running dev server', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  const a = await dev.start(root, fakeDev(join(root, 'p')));
  const b = await dev.start(root, fakeDev(join(root, 'p')));
  assert.equal(a.pid, b.pid);
  await dev.stop(root);
});

test('stopOthers keeps only the chosen project', async () => {
  const r1 = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  const r2 = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  const a = await dev.start(r1, fakeDev(join(r1, 'p')));
  const b = await dev.start(r2, fakeDev(join(r2, 'p')));
  await dev.stopOthers(r2);
  assert.ok(await until(() => !alive(a.pid)));
  assert.ok(alive(b.pid));
  await dev.stop(r2);
});

test('sweepLeftovers stops a leftover from a killed editor, but not unrelated processes', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  // A leftover dev server: its own process group, working folder = root.
  const leftover = spawn('sh', ['-c', 'sleep 60 & wait'], { cwd: root, detached: true, stdio: 'ignore' });
  // An unrelated process whose PID is in the file, but whose folder is different (a reused PID).
  const other = spawn('sleep', ['60'], { cwd: tmpdir(), detached: true, stdio: 'ignore' });
  writeFileSync(
    join(STATE, 'dev-servers.json'),
    JSON.stringify([
      { pid: leftover.pid, root, port: 4999, startedAt: '' },
      { pid: other.pid, root, port: 4998, startedAt: '' },
    ]),
  );
  assert.equal(dev.sweepLeftovers(), 1);
  assert.ok(await until(() => !alive(leftover.pid!)), 'leftover still running');
  assert.ok(alive(other.pid!), 'an unrelated process was stopped');
  process.kill(other.pid!, 'SIGKILL');
});

test('with no goastro tab open for 3 minutes, the dev server stops', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ace-proj-'));
  const info = await dev.start(root, fakeDev(join(root, 'p')));
  const now = Date.now();
  dev.heartbeat(now);
  dev.checkIdle(now + 60_000);
  assert.ok(dev.status(root), 'a tab was seen a minute ago: keep running');
  dev.checkIdle(now + dev.NO_TAB_MS + 1000);
  assert.ok(await until(() => !alive(info.pid)), 'stopped after 3 minutes without a tab');
  dev.heartbeat();
});
