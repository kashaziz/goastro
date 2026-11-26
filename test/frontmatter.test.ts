import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyFrontmatter, readFrontmatter } from '../server/core/frontmatter.ts';

const YAML = `# A YAML comment that must survive
title: 'Edge cases: everything at once'
description: >
  Folded description
  over two lines.
pubDate: 2026-01-15
tags:
  - alpha
  - "beta"
categories: ["one", "two"]
seo:
  metaTitle: "Meta"
draft: false
`;

const lines = (s: string) => s.split('\n');
function changedLines(a: string, b: string) {
  const la = lines(a);
  const lb = lines(b);
  return lb.filter((l) => !la.includes(l));
}

test('unchanged values leave the text identical', () => {
  const data = readFrontmatter(YAML).data;
  const r = applyFrontmatter(YAML, Object.keys(data).map((k) => ({ path: [k], value: data[k] })));
  assert.equal(r.yaml, YAML);
  assert.deepEqual(r.changed, []);
});

test('changing a title keeps its quote style and every other line', () => {
  const r = applyFrontmatter(YAML, [{ path: ['title'], value: "It's new: really" }]);
  assert.deepEqual(changedLines(YAML, r.yaml), [`title: 'It''s new: really'`]);
  assert.ok(r.yaml.startsWith('# A YAML comment that must survive\n'));
});

test('date stays an unquoted YYYY-MM-DD string', () => {
  const r = applyFrontmatter(YAML, [{ path: ['pubDate'], value: '2026-02-01' }]);
  assert.deepEqual(changedLines(YAML, r.yaml), ['pubDate: 2026-02-01']);
});

test('block and flow tag lists keep their style', () => {
  const r = applyFrontmatter(YAML, [
    { path: ['tags'], value: ['alpha', 'gamma', 'delta'] },
    { path: ['categories'], value: ['one', 'three'] },
  ]);
  assert.ok(r.yaml.includes('tags:\n  - alpha\n  - gamma\n  - delta\ncategories'));
  assert.ok(r.yaml.includes('categories: ["one", "three"]'));
  assert.deepEqual(readFrontmatter(r.yaml).data.tags, ['alpha', 'gamma', 'delta']);
});

test('nested, new and removed keys', () => {
  const r = applyFrontmatter(YAML, [
    { path: ['seo', 'metaTitle'], value: 'New meta' },
    { path: ['seo', 'metaDescription'], value: 'Added description' },
    { path: ['heroImage'], value: '/images/hero.webp' },
    { path: ['draft'], value: undefined },
  ]);
  const data = readFrontmatter(r.yaml).data as Record<string, any>;
  assert.equal(data.seo.metaTitle, 'New meta');
  assert.equal(data.seo.metaDescription, 'Added description');
  assert.equal(data.heroImage, '/images/hero.webp');
  assert.equal('draft' in data, false);
  assert.equal(data.description, 'Folded description over two lines.\n');
  assert.ok(r.yaml.includes('  metaTitle: "New meta"'));
});

test('editing a folded description produces valid YAML with the new value', () => {
  const r = applyFrontmatter(YAML, [{ path: ['description'], value: 'Short and new.' }]);
  assert.equal(readFrontmatter(r.yaml).data.description, 'Short and new.');
  assert.ok(r.yaml.includes('pubDate: 2026-01-15'));
});
