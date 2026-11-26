// Project detection, per-project settings and content listing.
// Settings live in the tool's own config folder, never inside your Astro repository.
import { existsSync, readFileSync, readdirSync, statSync, mkdirSync, writeFileSync, renameSync, realpathSync } from 'node:fs';
import { join, relative, resolve, sep, basename, extname, dirname, delimiter } from 'node:path';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { splitFrontmatter, readFrontmatter, isSafeFieldPath } from './frontmatter.ts';
import { CONFIG_DIR, env } from './paths.ts';
export { BACKUP_DIR } from './paths.ts';

export type FieldType = 'text' | 'textarea' | 'date' | 'tags' | 'boolean' | 'number' | 'image' | 'select' | 'yaml';

export interface FieldConfig {
  key: string; // dot path, e.g. "seo.metaDescription"
  label: string;
  type: FieldType;
  options?: string[]; // for "select"
}

export interface CollectionConfig {
  name: string;
  dir: string; // relative to project root
  urlPattern: string; // e.g. "/blog/{slug}/"
  fields: FieldConfig[];
}

export interface ProjectConfig {
  devServerUrl: string;
  collections: CollectionConfig[];
}

/** Settings for goastro itself, edited on the home page. */
export interface GlobalSettings {
  projectDirs: string[]; // folders searched for projects, "~" allowed
  port: number; // editor port
  idleMinutes: number; // stop an unused dev server after this many minutes
}

export const DEFAULT_SETTINGS: GlobalSettings = {
  projectDirs: ['~/work', '~/projects', '~/code', '~/dev', '~/src', '~/Sites'],
  port: 4545,
  idleMinutes: 30,
};

interface Store {
  recent: string[];
  projects: Record<string, ProjectConfig>;
  settings?: Partial<GlobalSettings>;
  hidden?: string[]; // projects removed from the home page
}

const STORE_FILE = join(CONFIG_DIR, 'projects.json');

function loadStore(): Store {
  let raw: string;
  try {
    raw = readFileSync(STORE_FILE, 'utf8');
  } catch {
    return { recent: [], projects: {} }; // first run
  }
  try {
    const s = JSON.parse(raw) as Store;
    return { recent: s.recent ?? [], projects: s.projects ?? {}, settings: s.settings, hidden: s.hidden ?? [] };
  } catch {
    // Keep the broken file instead of overwriting it with empty settings on the next save.
    const keep = `${STORE_FILE}.broken-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    try {
      renameSync(STORE_FILE, keep);
      console.error(`goastro: ${STORE_FILE} is not valid JSON. It was moved to ${keep}. Starting with empty settings.`);
    } catch {
      // cannot move it: carry on with defaults
    }
    return { recent: [], projects: {} };
  }
}

/** Saved settings, without environment overrides. This is what the Settings panel edits. */
export function savedSettings(): GlobalSettings {
  return { ...DEFAULT_SETTINGS, ...loadStore().settings };
}

/** Settings in effect: saved settings, then environment variables on top. */
export function effectiveSettings(): GlobalSettings & { overridden: (keyof GlobalSettings)[] } {
  const s = savedSettings();
  const overridden: (keyof GlobalSettings)[] = [];
  const dirs = env('PROJECTS_DIRS');
  if (dirs) {
    s.projectDirs = dirs.split(delimiter).filter(Boolean); // ':' on macOS/Linux, ';' on Windows
    overridden.push('projectDirs');
  }
  const port = env('PORT');
  if (port) {
    s.port = Number(port);
    overridden.push('port');
  }
  const idle = env('DEV_IDLE_MINUTES');
  if (idle) {
    s.idleMinutes = Number(idle);
    overridden.push('idleMinutes');
  }
  return { ...s, overridden };
}

/** Check and save global settings. Throws a readable error for bad values. */
export function saveSettings(input: Partial<GlobalSettings>): GlobalSettings {
  const next = { ...savedSettings() };
  // Only the known keys are taken from the request.
  if (input.projectDirs !== undefined) next.projectDirs = input.projectDirs;
  if (input.port !== undefined) next.port = input.port;
  if (input.idleMinutes !== undefined) next.idleMinutes = input.idleMinutes;
  if (!Array.isArray(next.projectDirs) || next.projectDirs.some((d) => typeof d !== 'string'))
    throw new Error('Project folders must be a list of paths');
  next.projectDirs = [...new Set(next.projectDirs.map((d) => d.trim()).filter(Boolean))];
  if (!Number.isInteger(next.port) || next.port < 1024 || next.port > 65535) throw new Error('The port must be a whole number from 1024 to 65535');
  if (!Number.isFinite(next.idleMinutes) || next.idleMinutes < 1 || next.idleMinutes > 1440)
    throw new Error('The idle time must be from 1 to 1440 minutes');
  const store = loadStore();
  store.settings = next;
  saveStore(store);
  return next;
}

export const expandHome = (p: string) => p.trim().replace(/^~(?=$|[\\/])/, homedir());

function saveStore(s: Store) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const tmp = `${STORE_FILE}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2), { flag: 'wx', mode: 0o600 });
  renameSync(tmp, STORE_FILE); // atomic: a crash never leaves half a file
}

export function recentProjects(): string[] {
  return loadStore().recent.filter((p) => existsSync(p));
}

export type ProjectKind = 'astro' | 'markdown';

/** 'astro' for an Astro project, 'markdown' for any other folder with .md or .mdx files, else null. */
export function projectKind(root: string): ProjectKind | null {
  if (isAstroProject(root)) return 'astro';
  return hasMarkdown(root) ? 'markdown' : null;
}

/** True if the folder holds at least one .md or .mdx file, at most 4 levels down. */
export function hasMarkdown(root: string, depth = 4): boolean {
  const walk = (d: string, level: number): boolean => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const e of entries) if (e.isFile() && CONTENT_EXT.has(extname(e.name).toLowerCase())) return true;
    if (level >= depth) return false;
    for (const e of entries)
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules' && walk(join(d, e.name), level + 1)) return true;
    return false;
  };
  return walk(root, 1);
}

export function isAstroProject(root: string): boolean {
  if (['astro.config.mjs', 'astro.config.ts', 'astro.config.js', 'astro.config.mts', 'astro.config.cjs'].some((f) => existsSync(join(root, f))))
    return true;
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return Boolean(pkg.dependencies?.astro || pkg.devDependencies?.astro);
  } catch {
    return false;
  }
}

/** Folders searched for projects, from settings (or GOASTRO_PROJECTS_DIRS). Only folders that exist. */
export function projectDirs(): string[] {
  return effectiveSettings()
    .projectDirs.map(expandHome)
    .filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
}

/** The search folders and the folders one level inside them. "my-blog" is found in ~/work/team/my-blog. */
function searchRoots(): string[] {
  const out: string[] = [];
  for (const d of projectDirs()) {
    out.push(d);
    try {
      for (const e of readdirSync(d, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') out.push(join(d, e.name));
    } catch {
      // unreadable folder
    }
  }
  return out;
}

/**
 * Turn user input into an absolute path. A path (with "/" or "~") is used as is.
 * A bare folder name such as "my-blog" is looked up in the project folders, two levels deep.
 */
export function resolveProjectInput(input: string): string {
  const s = expandHome(input);
  if (/[\\/]/.test(s) || s.startsWith('.') || /^[A-Za-z]:/.test(s)) return resolve(s); // a path, also C:\... on Windows
  // A folder with that name right here wins. Then the project folders, but only real projects:
  // a bare "docs" must not open some other project's docs folder.
  const here = resolve(s);
  if (existsSync(here) && statSync(here).isDirectory() && projectKind(here)) return here;
  for (const d of searchRoots()) {
    const p = join(d, s);
    if (existsSync(p) && statSync(p).isDirectory() && projectKind(p)) return p;
  }
  return here;
}

export interface ProjectSummary {
  root: string;
  name: string;
  kind: ProjectKind;
  recent: boolean;
}

/** Recent projects first, then Astro projects found in the search folders. */
export function listProjects(): ProjectSummary[] {
  const seen = new Set<string>(hiddenProjects());
  const out: ProjectSummary[] = [];
  for (const root of recentProjects()) {
    if (seen.has(root)) continue;
    const kind = projectKind(root);
    if (!kind) continue;
    seen.add(root);
    out.push({ root, name: basename(root), kind, recent: true });
  }
  // A project can sit at <search folder>/<name> or <search folder>/<group>/<name>.
  const candidates: string[] = [];
  for (const r of searchRoots()) {
    try {
      for (const e of readdirSync(r, { withFileTypes: true }))
        if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') candidates.push(join(r, e.name));
    } catch {
      // unreadable folder
    }
  }
  const found: ProjectSummary[] = [];
  for (const d of candidates) {
    if (seen.has(d) || !isAstroProject(d)) continue;
    seen.add(d);
    found.push({ root: d, name: basename(d), kind: 'astro', recent: false });
  }
  found.sort((a, b) => a.name.localeCompare(b.name));
  return [...out, ...found.slice(0, 200)];
}

export function getConfig(root: string): ProjectConfig {
  const store = loadStore();
  return store.projects[root] ?? detectConfig(root);
}

export function saveConfig(root: string, config: ProjectConfig) {
  const store = loadStore();
  store.projects[root] = config;
  saveStore(store);
}

/** Remove a project from the home page: drop it from Recent and stop listing it. Opening it again shows it again. */
export function hideProject(root: string) {
  const store = loadStore();
  store.recent = store.recent.filter((p) => p !== root);
  store.hidden = [...new Set([...(store.hidden ?? []), root])];
  saveStore(store);
}

export function hiddenProjects(): string[] {
  return loadStore().hidden ?? [];
}

/** Show all hidden projects on the home page again. */
export function unhideAll() {
  const store = loadStore();
  store.hidden = [];
  saveStore(store);
}

export function touchRecent(root: string) {
  const store = loadStore();
  store.hidden = (store.hidden ?? []).filter((p) => p !== root);
  store.recent = [root, ...store.recent.filter((p) => p !== root)].slice(0, 12);
  if (!store.projects[root]) store.projects[root] = detectConfig(root);
  saveStore(store);
}

// ---------- content files ----------

const CONTENT_EXT = new Set(['.md', '.mdx']);

export function walkContent(dir: string, limit = 5000): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (out.length >= limit) return;
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile() && CONTENT_EXT.has(extname(e.name).toLowerCase())) out.push(p); // symlinks are skipped
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * Like inside(), and also follows symlinks: the real target must stay inside the real project folder.
 * Returns the real path, so a save writes through a symlink that points inside the project.
 */
export function insideReal(root: string, rel: string): string {
  const abs = inside(root, rel);
  let real: string;
  try {
    real = realpathSync(abs);
  } catch {
    try {
      real = join(realpathSync(dirname(abs)), basename(abs)); // new file: check its folder
    } catch {
      return abs;
    }
  }
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error('Path is outside the project');
  return real;
}

/** Resolve a path inside root. Throws if it escapes the root. */
export function inside(root: string, rel: string): string {
  const abs = resolve(root, rel);
  if (abs !== root && !abs.startsWith(root + sep)) throw new Error('Path is outside the project');
  return abs;
}

/** A content file must sit inside a configured collection folder. */
export function contentPath(root: string, config: ProjectConfig, rel: string): { abs: string; collection: CollectionConfig } {
  const abs = inside(root, rel);
  if (!CONTENT_EXT.has(extname(abs).toLowerCase())) throw new Error('Only .md and .mdx files can be edited');
  const collection = config.collections.find((c) => abs.startsWith(inside(root, c.dir) + sep));
  if (!collection) throw new Error('File is not in a configured content folder');
  return { abs: insideReal(root, rel), collection };
}

export interface FileSummary {
  path: string; // relative to project root
  id: string; // relative to collection dir, without extension
  title: string;
  date: string;
  draft: boolean;
}

function summarize(root: string, col: CollectionConfig, abs: string): FileSummary {
  const id = relative(inside(root, col.dir), abs).replace(/\.(md|mdx)$/i, '').split(sep).join('/');
  let data: Record<string, unknown> = {};
  try {
    const text = readFileSync(abs, 'utf8');
    data = readFrontmatter(splitFrontmatter(text.replace(/^﻿/, '').replace(/\r\n/g, '\n')).yaml).data;
  } catch {
    /* unreadable frontmatter: list the file anyway */
  }
  const dateKey = ['pubDate', 'publishDate', 'date', 'published', 'updated'].find((k) => data[k]);
  const status = String(data.status ?? '');
  return {
    path: relative(root, abs).split(sep).join('/'),
    id,
    title: typeof data.title === 'string' ? data.title : basename(abs),
    date: dateKey ? String(data[dateKey] instanceof Date ? (data[dateKey] as Date).toISOString().slice(0, 10) : data[dateKey]).slice(0, 10) : '',
    draft: data.draft === true || status === 'draft',
  };
}

export function listFiles(root: string, config: ProjectConfig) {
  return config.collections.map((c) => {
    insideReal(root, c.dir); // a symlinked folder must point inside the project
    // walkContent skips symlinked files and folders, so nothing outside the project is listed.
    return { name: c.name, dir: c.dir, files: walkContent(inside(root, c.dir)).map((f) => summarize(root, c, f)) };
  });
}

/** Build a preview URL from a collection pattern. Tokens: {slug} {id} {collection} or any frontmatter key. */
export function previewUrl(config: ProjectConfig, col: CollectionConfig, id: string, data: Record<string, unknown>): string {
  const path = col.urlPattern.replace(/\{([\w.]+)\}/g, (_, key: string) => {
    if (key === 'slug') return String(data.slug ?? id.replace(/(^|\/)index$/, ''));
    if (key === 'id') return id.replace(/(^|\/)index$/, '');
    if (key === 'collection') return col.name;
    const v = key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), data);
    return v === undefined ? '' : String(v);
  });
  const clean = ('/' + path).replace(/\/{2,}/g, '/');
  return config.devServerUrl.replace(/\/$/, '') + clean;
}

// ---------- detection ----------

function guessFieldType(key: string, values: unknown[]): FieldType {
  const v = values.find((x) => x !== null && x !== undefined);
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (v instanceof Date) return 'date';
  if (Array.isArray(v)) return v.every((x) => typeof x === 'string') ? 'tags' : 'yaml';
  if (v && typeof v === 'object') return 'yaml';
  const k = key.toLowerCase();
  const s = typeof v === 'string' ? v : '';
  if (/(date|updated|modified|published)$/i.test(key) || /^\d{4}-\d{2}-\d{2}([T ][\d:.]+Z?)?$/.test(s)) return 'date';
  if (/(image|img|thumbnail|cover|photo|banner)$/i.test(key) && !/alt$/i.test(key)) return 'image';
  if (/(description|excerpt|summary|blurb|abstract)/.test(k) || values.some((x) => typeof x === 'string' && x.length > 120)) return 'textarea';
  return 'text';
}

function labelFor(key: string): string {
  const last = key.split('.').pop()!;
  const words = last.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const PRIORITY = ['title', 'description', 'excerpt', 'summary', 'pubDate', 'publishDate', 'date', 'updatedDate', 'updated', 'modified', 'draft', 'status', 'tags', 'categories', 'category', 'image', 'heroImage', 'featuredImage', 'imageAlt'];

/** Infer form fields from the frontmatter of up to 60 files. */
export function detectFields(files: string[]): FieldConfig[] {
  const seen = new Map<string, unknown[]>();
  const add = (k: string, v: unknown) => {
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k)!.push(v);
  };
  for (const f of files.slice(0, 60)) {
    try {
      const data = readFrontmatter(splitFrontmatter(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).yaml).data;
      for (const [k, v] of Object.entries(data)) {
        // Small objects of plain values (for example seo: {metaTitle, metaDescription}) become separate fields.
        if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x === null || typeof x !== 'object')) {
          for (const [k2, v2] of Object.entries(v)) add(`${k}.${k2}`, v2);
        } else add(k, v);
      }
    } catch {
      /* skip unreadable file */
    }
  }
  const keys = [...seen.keys()].sort((a, b) => {
    const pa = PRIORITY.indexOf(a.split('.')[0]);
    const pb = PRIORITY.indexOf(b.split('.')[0]);
    return (pa === -1 ? 99 : pa) - (pb === -1 ? 99 : pb) || (seen.get(b)!.length - seen.get(a)!.length);
  });
  return keys.filter((key) => isSafeFieldPath(key.split('.'))).map((key) => {
    const values = seen.get(key)!;
    const type = guessFieldType(key, values);
    const field: FieldConfig = { key, label: labelFor(key), type };
    // Few distinct short strings across many files suggests a fixed choice, such as status.
    if (type === 'text' && /status|type|layout/i.test(key)) {
      const distinct = [...new Set(values.filter((x) => typeof x === 'string'))] as string[];
      if (distinct.length > 1 && distinct.length <= 6) {
        field.type = 'select';
        field.options = distinct;
      }
    }
    return field;
  });
}

/** Map collection names to page routes by reading src/pages for getCollection('name'). */
function detectRoutes(root: string): Map<string, string> {
  const routes = new Map<string, string>();
  const pagesDir = join(root, 'src', 'pages');
  const walk = (d: string) => {
    let entries;
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^\[(\.\.\.)?(slug|id|path)\]\.astro$/.test(e.name)) {
        const src = readFileSync(p, 'utf8');
        const relDir = relative(pagesDir, d).split(sep).join('/');
        // One route file can serve several collections, for example getCollection('posts') and getCollection('pages').
        for (const m of src.matchAll(/getCollection\(\s*['"]([\w-]+)['"]/g)) {
          if (!routes.has(m[1])) routes.set(m[1], '/' + (relDir ? relDir + '/' : '') + '{slug}/');
        }
      }
    }
  };
  walk(pagesDir);
  return routes;
}

/** Folder names that often hold Markdown content outside Astro (Docusaurus, Hugo, Jekyll, Eleventy, plain docs). */
const MD_FOLDERS = ['content', 'docs', 'posts', '_posts', 'blog', 'articles', 'notes', 'pages', 'src/content', 'src/posts'];

function detectMarkdownConfig(root: string): ProjectConfig {
  const collections: CollectionConfig[] = [];
  for (const dir of MD_FOLDERS) {
    const abs = join(root, dir);
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue;
    if (collections.some((c) => abs.startsWith(join(root, c.dir) + sep))) continue; // already inside another folder
    const files = walkContent(abs, 200);
    if (files.length) collections.push({ name: dir.replace(/^_/, '').split('/').pop()!, dir, urlPattern: '/{id}/', fields: detectFields(files) });
  }
  if (!collections.length) {
    const files = walkContent(root, 200);
    if (files.length) collections.push({ name: basename(root), dir: '.', urlPattern: '/{id}/', fields: detectFields(files) });
  }
  return { devServerUrl: 'http://localhost:3000', collections };
}

export function detectConfig(root: string): ProjectConfig {
  if (!isAstroProject(root)) return detectMarkdownConfig(root);
  const collections: CollectionConfig[] = [];
  const routes = detectRoutes(root);
  const contentDir = join(root, 'src', 'content');
  if (existsSync(contentDir)) {
    for (const e of readdirSync(contentDir, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.') || e.name.startsWith('_')) continue;
      const files = walkContent(join(contentDir, e.name), 200);
      if (!files.length) continue;
      collections.push({
        name: e.name,
        dir: `src/content/${e.name}`,
        urlPattern: routes.get(e.name) ?? `/${e.name}/{slug}/`,
        fields: detectFields(files),
      });
    }
  }
  const pagesDir = join(root, 'src', 'pages');
  if (existsSync(pagesDir) && statSync(pagesDir).isDirectory()) {
    const files = walkContent(pagesDir, 200);
    if (files.length) collections.push({ name: 'pages', dir: 'src/pages', urlPattern: '/{id}/', fields: detectFields(files) });
  }
  return { devServerUrl: 'http://localhost:4321', collections };
}
