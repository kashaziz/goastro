// Where goastro keeps its own files. Nothing is ever written to your projects except the content files you save.
//   settings:  ~/.config/goastro/projects.json
//   backups:   ~/.local/state/goastro/backups/
//   dev PIDs:  ~/.local/state/goastro/dev-servers.json
// Older versions used "astro-content-editor" folders. They are moved on first use.
import { existsSync, mkdirSync, renameSync, cpSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';

const env = (name: string) => process.env[`GOASTRO_${name}`] ?? process.env[`ACE_${name}`];

const xdgConfig = process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
const xdgState = process.env.XDG_STATE_HOME ?? join(homedir(), '.local', 'state');

export const CONFIG_DIR = env('CONFIG_DIR') ?? join(xdgConfig, 'goastro');
export const STATE_DIR = env('STATE_DIR') ?? join(xdgState, 'goastro');
export const BACKUP_DIR = env('BACKUP_DIR') ?? join(STATE_DIR, 'backups');

const OLD_CONFIG_DIR = join(xdgConfig, 'astro-content-editor');
const OLD_STATE_DIR = join(xdgState, 'astro-content-editor');

/** Move the folders of the old "astro-content-editor" name, once. Uses copy if a rename is not possible. */
export function migrateOldFolders(): string[] {
  const moved: string[] = [];
  const move = (from: string, to: string) => {
    if (!existsSync(from) || existsSync(to)) return;
    mkdirSync(dirname(to), { recursive: true });
    try {
      renameSync(from, to);
    } catch {
      cpSync(from, to, { recursive: true });
    }
    moved.push(`${from} → ${to}`);
  };
  if (!env('CONFIG_DIR')) move(OLD_CONFIG_DIR, CONFIG_DIR);
  if (!env('STATE_DIR')) move(OLD_STATE_DIR, STATE_DIR);
  return moved;
}

export { env };
