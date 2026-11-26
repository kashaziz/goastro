// Command line: goastro [project] [--port N] [--no-open]   |   goastro stop [--port N]
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { isAstroProject, hasMarkdown, projectKind, resolveProjectInput, effectiveSettings } from './core/project.ts';
import { migrateOldFolders } from './core/paths.ts';
import { readSessionToken } from './core/session.ts';

const HELP = `Usage: goastro [project] [options]
       goastro stop [--port <n>]

Opens goastro, the visual editor for Astro content, in your browser.
It also works with any folder of Markdown (.md) or MDX (.mdx) files.

  project       Folder name or path of a project. A bare name is searched
                for in the project folders set on the goastro home page.
                With no project, goastro uses the Astro project you are in
                (this folder or a parent), else this folder if it has
                Markdown files, else it shows the home page.

Options:
  --port <n>    Port for the editor (default from settings: 4545)
  --no-open     Do not open the browser
  -h, --help    Show this help

If the editor is already running, goastro only opens a new browser tab.

goastro stop    Stops the running editor and the dev servers it started.
                (For a project folder named "stop", type ./stop.)

Dev servers that the editor starts for Preview stop when the editor stops.`;

function fail(msg: string): never {
  console.error(`goastro: ${msg}`);
  process.exit(1);
}

function parseArgs(argv: string[]) {
  let project: string | null = null;
  let stop = false;
  let port = effectiveSettings().port;
  let open = !(process.env.GOASTRO_NO_OPEN ?? process.env.ACE_NO_OPEN);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(HELP);
      process.exit(0);
    } else if (a === '--no-open') open = false;
    else if (a === '--port') port = Number(argv[++i]);
    else if (a.startsWith('--port=')) port = Number(a.slice(7));
    else if (a.startsWith('-')) fail(`unknown option ${a}. Run goastro --help.`);
    else if (a === 'stop' && project === null && !stop) stop = true;
    else if (stop) fail('goastro stop takes no project. Use --port to choose the editor.');
    else if (project === null) project = a;
    else fail('give only one project.');
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) fail('the port must be a number from 1 to 65535.');
  return { project, port, open, stop };
}

/** The current folder or the nearest parent that is an Astro project. Stops at the home folder. */
function findProjectUp(from: string): string | null {
  const home = homedir();
  let dir = resolve(from);
  for (;;) {
    if (isAstroProject(dir)) return dir;
    const up = dirname(dir);
    if (up === dir || dir === home) return null;
    dir = up;
  }
}

function resolveTarget(project: string | null): string | null {
  if (project === null) {
    const found = findProjectUp(process.cwd());
    if (found) return realpathSync(found);
    // Not inside an Astro project. Use this folder only if it looks like a content folder:
    // Markdown files right here, or a project (package.json or .git) with Markdown files near the top.
    const cwd = realpathSync(process.cwd());
    if (cwd === realpathSync(homedir())) return null;
    const isProject = existsSync(`${cwd}/package.json`) || existsSync(`${cwd}/.git`);
    return hasMarkdown(cwd, 1) || (isProject && hasMarkdown(cwd, 3)) ? cwd : null;
  }
  const abs = resolveProjectInput(project);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) fail(`folder not found: ${abs}`);
  if (!projectKind(abs)) fail(`no Markdown or MDX files found in ${abs}`);
  return realpathSync(abs);
}

function isWsl(): boolean {
  if (process.platform !== 'linux') return false;
  try {
    return /microsoft/i.test(readFileSync('/proc/version', 'utf8'));
  } catch {
    return false;
  }
}

function hasCommand(cmd: string): boolean {
  return (process.env.PATH ?? '').split(':').some((d) => d && existsSync(`${d}/${cmd}`));
}

/** Open a URL in the default browser. Failure is not an error: the URL is printed anyway. */
export function openBrowser(url: string) {
  let cmd: string;
  let args: string[];
  if (process.platform === 'darwin') [cmd, args] = ['open', [url]];
  else if (process.platform === 'win32') [cmd, args] = ['rundll32', ['url.dll,FileProtocolHandler', url]]; // no cmd.exe parsing
  // WSL: explorer.exe drops URLs with a query string and opens Documents instead. Windows' URL handler does not.
  else if (isWsl()) [cmd, args] = hasCommand('wslview') ? ['wslview', [url]] : ['rundll32.exe', ['url.dll,FileProtocolHandler', url]];
  else [cmd, args] = ['xdg-open', [url]];
  try {
    const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
    child.on('error', () => console.log('Could not open the browser. Open the URL above yourself.'));
    child.unref();
  } catch {
    console.log('Could not open the browser. Open the URL above yourself.');
  }
}

type PortState = 'ours' | 'old' | 'other' | 'free';

/**
 * Who listens on the port?
 * 'ours': this editor. 'old': an older editor version without /api/ping. 'other': another program. 'free': nothing.
 */
async function probe(port: number): Promise<PortState> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/ping`, { signal: AbortSignal.timeout(1000) });
    const data = (await r.json().catch(() => ({}))) as { app?: string; error?: string };
    if (data.app === 'goastro' || data.app === 'astro-content-editor') return 'ours';
    return data.error === 'Unknown API route' ? 'old' : 'other';
  } catch (e) {
    const code = (e as { cause?: { code?: string } }).cause?.code;
    return code === 'ECONNREFUSED' ? 'free' : 'other';
  }
}

/** The process that listens on a local TCP port, if the system tools can tell. */
function portOwner(port: number): { pid: number; cmd: string } | null {
  let pid = 0;
  try {
    const out = execFileSync('ss', ['-ltnpH', `sport = :${port}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    pid = Number(out.match(/pid=(\d+)/)?.[1] ?? 0);
  } catch {
    // no ss (macOS): try lsof
  }
  if (!pid) {
    try {
      const out = execFileSync('lsof', ['-t', `-iTCP:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      pid = Number(out.trim().split('\n')[0] || 0);
    } catch {
      return null;
    }
  }
  if (!pid) return null;
  let cmd = '';
  try {
    cmd = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' }).trim();
  } catch {
    // process gone
  }
  return { pid, cmd };
}

const describe = (port: number) => {
  const o = portOwner(port);
  return o ? `PID ${o.pid}${o.cmd ? `: ${o.cmd}` : ''}` : 'the program is unknown';
};

async function waitFree(port: number, ms = 10_000): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await probe(port)) === 'free') return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

async function stopEditor(port: number) {
  const state = await probe(port);
  if (state === 'free') {
    console.log(`No editor is running on port ${port}.`);
    return;
  }
  if (state === 'other') fail(`port ${port} is used by another program, not the editor (${describe(port)}). Nothing was stopped.`);
  if (state === 'old') {
    // Older versions cannot shut down by request. Stop the process directly.
    const o = portOwner(port);
    if (!o) fail(`an older editor runs on port ${port}, but its PID is unknown. Press Ctrl+C in its terminal.`);
    process.kill(o.pid, 'SIGTERM');
  } else {
    const r = await fetch(`http://127.0.0.1:${port}/api/shutdown`, {
      method: 'POST',
      headers: { 'x-goastro': 'stop', 'x-goastro-token': readSessionToken(port) ?? '', 'content-type': 'application/json' },
      body: '{}',
    }).catch(() => null);
    if (r?.status === 404) {
      // An editor from before "goastro stop" existed. SIGTERM also stops its dev servers.
      const o = portOwner(port);
      if (!o) fail(`the editor on port ${port} cannot be stopped by request, and its PID is unknown. Press Ctrl+C in its terminal.`);
      process.kill(o.pid, 'SIGTERM');
    } else if (!r?.ok) fail(`the editor on port ${port} did not accept the stop request.`);
  }
  if (await waitFree(port)) console.log(`Stopped the editor on port ${port}. Its dev servers are stopped too.`);
  else fail(`the editor on port ${port} is still running (${describe(port)}).`);
}

export async function main(argv = process.argv.slice(2)) {
  for (const m of migrateOldFolders()) console.log(`Moved goastro data: ${m}`);
  const opts = parseArgs(argv);
  if (opts.stop) return stopEditor(opts.port);
  const root = resolveTarget(opts.project);
  const base = `http://127.0.0.1:${opts.port}/`;
  // The link carries this run's access token (see server/core/session.ts). The page removes it from the address.
  const linkWith = (token: string | null) => {
    const q = new URLSearchParams();
    if (token) q.set('token', token);
    if (root) q.set('project', root);
    return base + (q.size ? `?${q}` : '');
  };

  const state = await probe(opts.port);
  if (state === 'old')
    fail(`an older version of the editor runs on port ${opts.port} (${describe(opts.port)}).\nStop it with: goastro stop --port ${opts.port}`);
  if (state === 'other')
    fail(`port ${opts.port} is used by another program (${describe(opts.port)}).\nStop that program, or use another port: goastro --port ${opts.port + 1}`);
  if (state === 'ours') {
    const link = linkWith(readSessionToken(opts.port));
    console.log(`goastro is already running. Opening a new tab.`);
    if (opts.open) openBrowser(link);
    else console.log(`Open: ${link}`);
    return;
  }

  const { startServer } = await import('./index.ts');
  let link = base;
  try {
    link = linkWith((await startServer(opts.port)).token);
  } catch (e) {
    fail((e as Error).message);
  }
  console.log(`goastro is running at ${base}`);
  if (!opts.open) console.log(`Open this link to start (it signs your browser in): ${link}`);
  if (root) console.log(`Project: ${root}`);
  else console.log('No project in this folder. Choose one on the home page.');
  console.log('Press Ctrl+C to stop. Dev servers started for Preview stop too.');
  if (opts.open) openBrowser(link);
}
