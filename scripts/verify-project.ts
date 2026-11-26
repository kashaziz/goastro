// Read-only safety check for an Astro project. Nothing is written.
// For every content file it simulates: open in the editor, save with no edits,
// and save after editing one paragraph. It reports any file that would change
// unexpectedly or lose protected content.
//
// Usage: npm run verify -- /path/to/astro-project [/another/project ...]
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';
import { createEditor } from './headless-editor.ts';
import { loadModel, composeText, auditChange } from '../server/core/document.ts';
import { flavorOf, type PMNode } from '../server/core/markdown.ts';
import { getConfig, inside, walkContent, isAstroProject, resolveProjectInput } from '../server/core/project.ts';

const roots = process.argv.slice(2);
if (!roots.length) {
  console.error('Usage: npm run verify -- /path/to/astro-project');
  process.exit(2);
}

let failures = 0;
for (const r of roots) {
  const root = resolveProjectInput(r);
  if (!isAstroProject(root)) {
    console.log(`SKIP ${root}: not an Astro project`);
    continue;
  }
  const config = getConfig(root);
  const stats = { files: 0, identical: 0, edited: 0, sourceOnly: 0, prose: 0, protected: 0, problems: [] as string[] };
  for (const col of config.collections) {
    for (const abs of walkContent(inside(root, col.dir))) {
      const rel = relative(root, abs);
      const flavor = flavorOf(abs);
      const text = readFileSync(abs, 'utf8');
      stats.files++;
      try {
        const model = loadModel(text, flavor);
        if (model.parseError) {
          stats.sourceOnly++;
          continue;
        }
        for (const b of model.blocks) b.kind === 'prose' ? stats.prose++ : stats.protected++;
        const editor = createEditor(model.doc);
        const nodes = () => editor.getJSON().content as PMNode[];

        const same = composeText(text, flavor, { nodes: nodes() }).text;
        if (same === text) stats.identical++;
        else stats.problems.push(`${rel}: changed without any edit`);

        let target = -1;
        editor.state.doc.forEach((n, offset) => {
          if (target < 0 && n.type.name === 'paragraph' && n.textContent.length > 10) target = offset;
        });
        if (target >= 0) {
          editor.chain().insertContentAt(target + 1, 'Verify ').run();
          const out = composeText(text, flavor, { nodes: nodes() }).text;
          const audit = auditChange(text, out, flavor);
          if (audit.missing.length) stats.problems.push(`${rel}: edit would lose ${audit.missing.map((m) => m.label).join(', ')}`);
          else if (audit.parseError) stats.problems.push(`${rel}: edit produces invalid syntax: ${audit.parseError}`);
          else stats.edited++;
        }
        editor.destroy();
      } catch (e) {
        stats.problems.push(`${rel}: ${(e as Error).message}`);
      }
    }
  }
  failures += stats.problems.length;
  const pct = stats.prose + stats.protected ? Math.round((stats.prose / (stats.prose + stats.protected)) * 100) : 0;
  console.log(
    `${stats.problems.length ? 'FAIL' : 'OK  '} ${root}\n` +
      `     ${stats.files} files · ${stats.identical} unchanged on plain save · ${stats.edited} edit tests passed · ` +
      `${stats.sourceOnly} source-only · ${pct}% of blocks visually editable`,
  );
  for (const p of stats.problems.slice(0, 20)) console.log(`     - ${p}`);
}
process.exit(failures ? 1 : 0);
