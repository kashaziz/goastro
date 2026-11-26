// Global settings, project search and non-Astro Markdown folders.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const CONF = mkdtempSync(join(tmpdir(), 'goastro-conf-'));
process.env.GOASTRO_CONFIG_DIR = CONF;
delete process.env.GOASTRO_PROJECTS_DIRS;
delete process.env.ACE_PROJECTS_DIRS;
delete process.env.GOASTRO_PORT;
const p = await import('../server/core/project.ts');

const md = (file: string, title = 'Hello') => {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `---\ntitle: ${title}\n---\n\nText.\n`);
};

test('settings: defaults, save, and validation', () => {
  assert.deepEqual(p.savedSettings(), p.DEFAULT_SETTINGS);
  const saved = p.saveSettings({ projectDirs: [' ~/a ', '~/a', ''], port: 5000, idleMinutes: 10 });
  assert.deepEqual(saved.projectDirs, ['~/a']);
  assert.equal(p.savedSettings().port, 5000);
  assert.throws(() => p.saveSettings({ port: 80 }), /port/);
  assert.throws(() => p.saveSettings({ idleMinutes: 0 }), /idle/);
  assert.equal(p.savedSettings().port, 5000, 'a rejected save changes nothing');
});

test('settings: environment variables override saved values', () => {
  process.env.GOASTRO_PROJECTS_DIRS = '/x:/y';
  process.env.GOASTRO_PORT = '4600';
  const e = p.effectiveSettings();
  assert.deepEqual(e.projectDirs, ['/x', '/y']);
  assert.equal(e.port, 4600);
  assert.deepEqual(e.overridden.sort(), ['port', 'projectDirs']);
  delete process.env.GOASTRO_PROJECTS_DIRS;
  delete process.env.GOASTRO_PORT;
});

test('a bare project name is found two levels deep in the search folders', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'goastro-work-')));
  const proj = join(work, 'someone', 'my-blog');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'astro.config.mjs'), 'export default {}');
  p.saveSettings({ projectDirs: [work] });
  assert.equal(p.resolveProjectInput('my-blog'), proj);
  const listed = p.listProjects().find((x) => x.root === proj);
  assert.equal(listed?.kind, 'astro');
});

test('a plain Markdown folder opens as a "markdown" project with detected folders', () => {
  const root = mkdtempSync(join(tmpdir(), 'goastro-md-'));
  md(join(root, 'docs', 'intro.md'));
  md(join(root, 'docs', 'guide', 'setup.mdx'));
  assert.equal(p.projectKind(root), 'markdown');
  const cfg = p.detectConfig(root);
  assert.deepEqual(cfg.collections.map((c) => c.dir), ['docs']);
  assert.equal(p.listFiles(root, cfg)[0].files.length, 2);
});

test('a Markdown folder without known folder names uses the whole folder', () => {
  const root = mkdtempSync(join(tmpdir(), 'goastro-md-'));
  md(join(root, 'note.md'), 'Note');
  const cfg = p.detectConfig(root);
  assert.equal(cfg.collections[0].dir, '.');
  const { collection } = p.contentPath(root, cfg, 'note.md');
  assert.equal(collection.dir, '.');
});

test('a folder with no Markdown is not a project', () => {
  const root = mkdtempSync(join(tmpdir(), 'goastro-empty-'));
  writeFileSync(join(root, 'a.txt'), 'x');
  assert.equal(p.projectKind(root), null);
});

test('a hidden project leaves the home page and comes back when opened', () => {
  const work = realpathSync(mkdtempSync(join(tmpdir(), 'goastro-work-')));
  const proj = join(work, 'site');
  mkdirSync(proj, { recursive: true });
  writeFileSync(join(proj, 'astro.config.mjs'), 'export default {}');
  p.saveSettings({ projectDirs: [work] });
  p.touchRecent(proj);
  assert.ok(p.listProjects().some((x) => x.root === proj && x.recent));
  p.hideProject(proj);
  assert.ok(!p.listProjects().some((x) => x.root === proj), 'hidden from recent and from the found list');
  p.touchRecent(proj);
  assert.ok(p.listProjects().some((x) => x.root === proj && x.recent), 'opening it shows it again');
  p.hideProject(proj);
  p.unhideAll();
  assert.ok(p.listProjects().some((x) => x.root === proj && !x.recent));
});

test('one route file that serves two collections gives both the same URL pattern', () => {
  const root = mkdtempSync(join(tmpdir(), 'goastro-routes-'));
  writeFileSync(join(root, 'astro.config.mjs'), 'export default {}');
  md(join(root, 'src/content/posts/a.md'));
  md(join(root, 'src/content/pages/b.md'));
  mkdirSync(join(root, 'src/pages'), { recursive: true });
  writeFileSync(join(root, 'src/pages/[...slug].astro'), "---\nconst posts = await getCollection('posts');\nconst pages = await getCollection(\"pages\");\n---\n");
  const cfg = p.detectConfig(root);
  const pattern = (name: string) => cfg.collections.find((c) => c.name === name)?.urlPattern;
  assert.equal(pattern('posts'), '/{slug}/');
  assert.equal(pattern('pages'), '/{slug}/');
});
