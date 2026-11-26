// Round-trip and safety tests on fixtures with the shapes of real Astro content (text replaced with lorem ipsum).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { structuredPatch } from 'diff';
import { compile } from '@mdx-js/mdx';
import { createEditor, type HeadlessEditor } from '../scripts/headless-editor.ts';
import { loadModel, composeText, auditChange } from '../server/core/document.ts';
import { flavorOf, parseBody, type PMNode } from '../server/core/markdown.ts';
import { splitFrontmatter } from '../server/core/frontmatter.ts';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const fixtures = readdirSync(DIR).filter((f) => /\.mdx?$/.test(f));
const read = (f: string) => readFileSync(join(DIR, f), 'utf8');

function editorFor(text: string, file: string) {
  const model = loadModel(text, flavorOf(file));
  return { model, editor: createEditor(model.doc) };
}

function save(text: string, file: string, editor: HeadlessEditor, fields = []) {
  return composeText(text, flavorOf(file), { nodes: editor.getJSON().content as PMNode[], fields }).text;
}

/** Position of the first top-level node matching pred. */
function findTop(editor: HeadlessEditor, pred: (n: { type: { name: string }; attrs: Record<string, unknown>; textContent: string }) => boolean) {
  let found: { pos: number; size: number; node: any } | null = null;
  editor.state.doc.forEach((node, offset) => {
    if (!found && pred(node as never)) found = { pos: offset, size: node.nodeSize, node };
  });
  return found as { pos: number; size: number; node: any } | null;
}

async function assertValid(file: string, text: string) {
  const body = splitFrontmatter(text.replace(/\r\n/g, '\n')).body;
  assert.doesNotThrow(() => parseBody(body, flavorOf(file)), `${file} must parse`);
  if (flavorOf(file) === 'mdx') await compile(body); // throws on invalid MDX
}

for (const file of fixtures) {
  test(`${file}: opening and saving without edits keeps the file byte-identical`, () => {
    const text = read(file);
    const { editor } = editorFor(text, file);
    assert.equal(save(text, file, editor), text);
    editor.destroy();
  });

  test(`${file}: editing one paragraph changes only that paragraph`, async () => {
    const text = read(file);
    const { model, editor } = editorFor(text, file);
    const target = findTop(editor, (n) => n.type.name === 'paragraph' && n.textContent.length > 20);
    if (!target) return; // some files are entirely raw HTML; see the dedicated test below
    editor.chain().insertContentAt(target!.pos + 1, 'EDITED ').run();
    const out = save(text, file, editor);
    assert.notEqual(out, text);
    assert.ok(out.includes('EDITED '));

    const audit = auditChange(text, out, flavorOf(file));
    assert.deepEqual(audit.missing, [], 'no protected content lost');
    assert.equal(audit.parseError, null);

    // Only one region changes, and it is the edited block.
    assert.ok(model.blocks.some((b) => b.id === target!.node.attrs.blockId && b.kind === 'prose'));
    const hunks = structuredPatch('a', 'b', text, out, '', '', { context: 0 }).hunks;
    assert.equal(hunks.length, 1, 'exactly one changed region');
    assert.ok(hunks[0].lines.some((l) => l.startsWith('+') && l.includes('EDITED ')));
    await assertValid(file, out);
    editor.destroy();
  });

  test(`${file}: formatting, links, lists and images serialize as Markdown`, async () => {
    const text = read(file);
    const { editor } = editorFor(text, file);
    // A paragraph that starts with a plain (unformatted) word, so "make bold" adds bold.
    const p = findTop(
      editor,
      (n: any) => n.type.name === 'paragraph' && /^[A-Za-z]{4,} /.test(n.textContent) && n.firstChild?.isText && !n.firstChild.marks.length,
    );
    if (!p) return; // fixture lacks a plain paragraph
    const word = p.node.textContent.split(' ')[0];
    editor.chain().setTextSelection({ from: p.pos + 1, to: p.pos + 1 + word.length }).toggleBold().run();
    const end = editor.state.doc.content.size;
    editor
      .chain()
      .insertContentAt(end, [
        { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'New section' }] },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'See ' },
            { type: 'text', text: 'the docs', marks: [{ type: 'link', attrs: { href: 'https://docs.astro.build' } }] },
            { type: 'text', text: ' for {braces} and <angles>.' },
          ],
        },
        { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] }] },
        { type: 'paragraph', content: [{ type: 'image', attrs: { src: '/images/new.webp', alt: 'A new image' } }] },
      ])
      .run();
    const out = save(text, file, editor);
    assert.ok(out.includes(`**${word}**`), 'bold word');
    assert.ok(out.includes('## New section'));
    assert.ok(out.includes('[the docs](https://docs.astro.build)'));
    assert.ok(out.includes('![A new image](/images/new.webp)'));
    assert.match(out, /\r?\n[-*+] One\r?\n/); // CRLF files keep CRLF
    const audit = auditChange(text, out, flavorOf(file));
    assert.deepEqual(audit.missing, []);
    await assertValid(file, out); // braces and angles must be escaped in MDX
    editor.destroy();
  });

  test(`${file}: removing a protected block is reported`, () => {
    const text = read(file);
    const { editor } = editorFor(text, file);
    const target = findTop(editor, (n) => n.type.name === 'protectedBlock');
    if (!target) return;
    editor.chain().deleteRange({ from: target.pos, to: target.pos + target.size }).run();
    const out = save(text, file, editor);
    const audit = auditChange(text, out, flavorOf(file));
    assert.equal(audit.missing.length >= 1, true, 'deletion is flagged');
    assert.equal(audit.missing[0].source, target.node.attrs.source);
    editor.destroy();
  });
}

test('edge cases: unsupported syntax is protected, not editable', () => {
  const model = loadModel(read('edge-cases.mdx'), 'mdx');
  const labels = model.blocks.filter((b) => b.kind === 'protected').map((b) => b.label);
  for (const expected of ['Import', 'MDX comment', 'Table', 'Code (js)', '<Callout>', 'Footnote', 'List (advanced)']) {
    assert.ok(labels.includes(expected), `${expected} is protected (got ${labels.join(', ')})`);
  }
  // Inline JSX and expressions stay editable around them as inline atoms.
  const json = JSON.stringify(model.doc);
  assert.ok(json.includes('"source":"{year}"'));
  assert.ok(json.includes('<Badge text=\\"new\\" />'));
});

test('edge cases: editing text next to inline JSX keeps the JSX', () => {
  const file = 'edge-cases.mdx';
  const text = read(file);
  const { editor } = editorFor(text, file);
  const p = findTop(editor, (n) => n.type.name === 'paragraph' && n.textContent.startsWith('A paragraph'))!;
  editor.chain().insertContentAt(p.pos + 1, 'Changed. ').run();
  const out = save(text, file, editor);
  assert.ok(out.includes('Changed. A paragraph with **bold**'));
  assert.ok(out.includes('{year}'));
  assert.ok(out.includes('<Badge text="new" />'));
  assert.ok(out.endsWith('Last paragraph without trailing newline.'));
  assert.deepEqual(auditChange(text, out, 'mdx').missing, []);
});

test('CRLF files keep CRLF line endings after an edit', () => {
  const file = 'crlf.mdx';
  const text = read(file);
  assert.ok(text.includes('\r\n'));
  const { editor } = editorFor(text, file);
  const p = findTop(editor, (n) => n.type.name === 'paragraph' && n.textContent.length > 5);
  if (p) editor.chain().insertContentAt(p.pos + 1, 'X ').run();
  const out = save(text, file, editor, [{ path: ['title'], value: 'New title' }] as never);
  assert.ok(!/(^|[^\r])\n/.test(out), 'no bare LF');
});

test('Markdown (.md): HTML comments and HTML blocks are protected', () => {
  const model = loadModel(read('edge-cases.md'), 'md');
  const labels = model.blocks.filter((b) => b.kind === 'protected').map((b) => b.label);
  assert.ok(labels.includes('HTML comment'));
  assert.ok(labels.includes('HTML'));
  assert.ok(JSON.stringify(model.doc).includes('<span class=\\"x\\">'));
});

test('a WordPress-style file made of raw HTML is fully protected', () => {
  const model = loadModel(read('html-no-newline.md'), 'md');
  assert.ok(model.blocks.length > 0);
  assert.ok(model.blocks.every((b) => b.kind === 'protected'));
});

test('mixed line endings: CRLF frontmatter is still frontmatter, and a field edit keeps one block', () => {
  const text = '---\r\ntitle: Hello\r\n---\r\n\nFirst paragraph.\n\nSecond paragraph.\n';
  const model = loadModel(text, 'md');
  assert.equal(model.frontmatter.title, 'Hello');
  const out = composeText(text, 'md', { fields: [{ path: ['draft'], value: true }] }).text;
  assert.equal(out.match(/^---/gm)?.length, 2, 'exactly one frontmatter block');
  assert.match(out, /draft: true/);
  assert.ok(out.includes('title: Hello'));
});

test('a line break at the end of a paragraph does not write a backslash', () => {
  const text = 'One two.\n';
  const { editor } = editorFor(text, 'a.md');
  editor.chain().setTextSelection(editor.state.doc.content.size - 1).setHardBreak().run();
  const bold = 'Bold.\n';
  const b = editorFor(bold, 'b.md');
  b.editor.chain().selectAll().toggleBold().setTextSelection(b.editor.state.doc.content.size - 1).setHardBreak().run();
  const out = save(text, 'a.md', editor);
  const outBold = save(bold, 'b.md', b.editor);
  assert.ok(!/\\\s*$/.test(out.trim()), `no trailing backslash: ${JSON.stringify(out)}`);
  assert.ok(!outBold.includes('&#xA;') && !/\\\*\*/.test(outBold), `no broken bold: ${JSON.stringify(outBold)}`);
  editor.destroy();
  b.editor.destroy();
});

test('deleting the block between two lists keeps them as two lists', () => {
  for (const [file, text, kind] of [
    ['a.md', '- a\n- b\n\nPara\n\n- c\n- d\n', 'bullet'],
    ['a.mdx', '1. a\n2. b\n\nPara\n\n1. c\n2. d\n', 'ordered'],
  ] as const) {
    const { model, editor } = editorFor(text, file);
    const para = findTop(editor, (n) => n.type.name === 'paragraph')!;
    editor.chain().deleteRange({ from: para.pos, to: para.pos + para.size }).run();
    const out = save(text, file, editor);
    const reread = loadModel(out, flavorOf(file));
    const lists = reread.doc.content!.filter((n) => n.type === (kind === 'bullet' ? 'bulletList' : 'orderedList'));
    assert.equal(lists.length, 2, `${kind}: still two lists in ${JSON.stringify(out)}`);
    assert.ok(model.blocks.length > 0);
    editor.destroy();
  }
});
