// Frontmatter reading and minimal-diff editing.
// Only the YAML text of changed values is replaced, so quoting, key order,
// comments and untouched lines stay exactly as they were.
import { parseDocument, Document, Scalar, YAMLMap, isScalar, isSeq, isMap, isCollection, type Node as YNode } from 'yaml';

export interface Split {
  hasFrontmatter: boolean;
  open: string; // "---\n"
  yaml: string; // YAML text between the fences
  close: string; // "---\n" (or "---" at end of file)
  body: string;
}

// \r?\n: a file can have CRLF frontmatter and LF lines further down (mixed line endings).
const FENCE = /^---[ \t]*\r?\n([\s\S]*?\r?\n)?(---[ \t]*(?:\r?\n|$))/;

export function splitFrontmatter(text: string): Split {
  const m = FENCE.exec(text);
  if (!m) return { hasFrontmatter: false, open: '', yaml: '', close: '', body: text };
  const openLen = m[0].indexOf('\n') + 1;
  return {
    hasFrontmatter: true,
    open: m[0].slice(0, openLen),
    yaml: m[1] ?? '',
    close: m[2],
    body: text.slice(m[0].length),
  };
}

export function readFrontmatter(yaml: string): { data: Record<string, unknown>; error: string | null } {
  const doc = parseDocument(yaml);
  if (doc.errors.length) return { data: {}, error: doc.errors[0].message };
  let data: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    data = doc.toJS(); // can throw, for example on too many aliases
  } catch (e) {
    return { data: {}, error: (e as Error).message };
  }
  return { data: data && typeof data === 'object' && !Array.isArray(data) ? data : {}, error: null };
}

export function deepEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface FieldChange {
  path: string[];
  value: unknown; // undefined = remove the key
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** A field path is 1 or 2 plain keys. Keys such as __proto__ are refused (prototype pollution). */
export function isSafeFieldPath(path: unknown): path is string[] {
  return Array.isArray(path) && path.length >= 1 && path.length <= 2 && path.every((k) => typeof k === 'string' && k !== '' && !UNSAFE_KEYS.has(k));
}

function getPath(obj: unknown, path: string[]): unknown {
  let cur: unknown = obj;
  for (const k of path) {
    if (!cur || typeof cur !== 'object' || !Object.hasOwn(cur, k)) return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return cur;
}

function setPath(obj: Record<string, unknown>, path: string[], value: unknown) {
  if (!isSafeFieldPath(path)) throw new Error(`Invalid field name: ${String(path)}`);
  let cur = obj;
  for (const k of path.slice(0, -1)) {
    if (!Object.hasOwn(cur, k) || !cur[k] || typeof cur[k] !== 'object') cur[k] = {};
    cur = cur[k] as Record<string, unknown>;
  }
  const last = path[path.length - 1];
  if (value === undefined) delete cur[last];
  else cur[last] = value;
}

const isBlockScalar = (t: unknown) => t === 'BLOCK_LITERAL' || t === 'BLOCK_FOLDED';

/** The quote style most string values use, so new values match the file. */
function dominantQuote(doc: Document): Scalar.Type | undefined {
  const counts = new Map<string, number>();
  const visit = (n: unknown) => {
    if (isScalar(n) && typeof n.value === 'string' && n.type) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
    else if (isCollection(n)) for (const it of n.items) visit(isScalar(it) || isCollection(it) ? it : (it as { value: unknown }).value);
  };
  visit(doc.contents);
  let best: string | undefined;
  for (const [t, c] of counts) if (!best || c > (counts.get(best) ?? 0)) best = t;
  return isBlockScalar(best) ? 'QUOTE_DOUBLE' : (best as Scalar.Type | undefined);
}

function prefersFlowSeq(doc: Document): boolean {
  let flow = 0;
  let block = 0;
  const visit = (n: unknown) => {
    if (isSeq(n)) n.flow ? flow++ : block++;
    if (isCollection(n)) for (const it of n.items) visit(isScalar(it) || isCollection(it) ? it : (it as { value: unknown }).value);
  };
  visit(doc.contents);
  return flow > block;
}

/** Build a YAML node for value, copying style from the node it replaces. */
function styledNode(doc: Document, value: unknown, template: YNode | null | undefined, quote: Scalar.Type | undefined, flow: boolean): YNode {
  const node = doc.createNode(value) as YNode;
  const scalarType = (t: unknown) => (t && !isBlockScalar(t) ? (t as Scalar.Type) : quote);
  const styleScalar = (n: unknown, t: Scalar.Type | undefined) => {
    if (isScalar(n) && typeof n.value === 'string' && t) n.type = t;
  };
  if (isScalar(node)) {
    styleScalar(node, isScalar(template) ? scalarType(template.type) : quote);
  } else if (isSeq(node)) {
    node.flow = isSeq(template) ? !!template.flow : isScalar(template) ? true : flow;
    const first = isSeq(template) ? template.items[0] : undefined;
    const t = isScalar(first) ? scalarType(first.type) : quote;
    for (const it of node.items) styleScalar(it, t);
  } else if (isMap(node)) {
    if (isMap(template) && template.flow) node.flow = true;
    for (const pair of node.items) {
      const tpl = isMap(template) ? template.get(pair.key as never, true) : undefined;
      styleScalar(pair.value, isScalar(tpl) ? scalarType(tpl.type) : quote);
    }
  }
  return node;
}

function render(node: YNode): string {
  const d = new Document();
  d.contents = node;
  return d.toString({ lineWidth: 0, flowCollectionPadding: false }).replace(/\n$/, '');
}

function column(src: string, offset: number): number {
  return offset - (src.lastIndexOf('\n', offset - 1) + 1);
}
function lineStart(src: string, offset: number): number {
  return src.lastIndexOf('\n', offset - 1) + 1;
}
function lineEnd(src: string, offset: number): number {
  const i = src.indexOf('\n', offset);
  return i === -1 ? src.length : i + 1;
}

interface Edit {
  start: number;
  end: number;
  text: string;
}

function surgical(yaml: string, changes: FieldChange[]): string | null {
  const doc = parseDocument(yaml);
  if (doc.errors.length) return null;
  if (doc.contents !== null && !isMap(doc.contents)) return null;
  if (isMap(doc.contents) && doc.contents.flow) return null;
  const quote = dominantQuote(doc);
  const flow = prefersFlowSeq(doc);
  const edits: Edit[] = [];
  let appended = '';

  for (const { path, value } of changes) {
    if (path.length > 2) return null;
    const parent = path.length === 1 ? doc.contents : doc.getIn(path.slice(0, -1), true);
    const key = path[path.length - 1];
    const pair = isMap(parent) ? parent.items.find((p) => isScalar(p.key) && String(p.key.value) === key) : undefined;

    if (value === undefined) {
      if (!pair) continue;
      const keyNode = pair.key as YNode;
      const valNode = pair.value as YNode | null;
      const end = valNode?.range ? valNode.range[1] : keyNode.range![1];
      const stop = yaml[end - 1] === '\n' ? end : lineEnd(yaml, end);
      edits.push({ start: lineStart(yaml, keyNode.range![0]), end: stop, text: '' });
      continue;
    }

    if (pair) {
      const keyNode = pair.key as YNode;
      const valNode = pair.value as YNode | null;
      const emptyValue = !valNode || (isScalar(valNode) && valNode.range![0] === valNode.range![1]);
      if (emptyValue) {
        const colon = yaml.indexOf(':', keyNode.range![1]);
        const node = styledNode(doc, value, null, quote, true);
        if (isCollection(node)) node.flow = true;
        edits.push({ start: colon + 1, end: colon + 1, text: ' ' + render(node) });
        continue;
      }
      const node = styledNode(doc, value, valNode, quote, flow);
      // A scalar written inline after "key:" cannot become a block collection.
      if (isScalar(valNode) && isCollection(node)) node.flow = true;
      const start = valNode!.range![0];
      const col = column(yaml, start);
      const lines = render(node).split('\n');
      const end = valNode!.range![1];
      let text = lines.map((l, i) => (i === 0 ? l : ' '.repeat(col) + l)).join('\n');
      // Block collections end after their final newline; keep that newline.
      if (yaml[end - 1] === '\n') text += '\n';
      edits.push({ start, end, text });
      continue;
    }

    // New key.
    if (path.length === 1) {
      const m = new YAMLMap();
      m.items.push(doc.createPair(key, null));
      m.items[0].value = styledNode(doc, value, null, quote, flow);
      appended += render(m) + '\n';
    } else if (isMap(parent) && !parent.flow && parent.items.length) {
      const firstKey = parent.items[0].key as YNode;
      const col = column(yaml, firstKey.range![0]);
      const m = new YAMLMap();
      m.items.push(doc.createPair(key, null));
      m.items[0].value = styledNode(doc, value, null, quote, flow);
      const text = render(m).split('\n').map((l) => ' '.repeat(col) + l).join('\n') + '\n';
      const at = lineEnd(yaml, parent.range![1] - 1);
      edits.push({ start: at, end: at, text: (yaml[at - 1] === '\n' || at === 0 ? '' : '\n') + text });
    } else if (!parent) {
      const m = new YAMLMap();
      m.items.push(doc.createPair(path[0], null));
      const inner = new YAMLMap();
      inner.items.push(doc.createPair(key, null));
      inner.items[0].value = styledNode(doc, value, null, quote, flow);
      m.items[0].value = inner;
      appended += render(m) + '\n';
    } else {
      return null;
    }
  }

  edits.sort((a, b) => b.start - a.start);
  let out = yaml;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  if (appended) out += (out === '' || out.endsWith('\n') ? '' : '\n') + appended;
  return out;
}

/** Full re-serialization. Used only when the surgical edit cannot be verified. */
function fallback(yaml: string, changes: FieldChange[]): string {
  const doc = parseDocument(yaml);
  for (const { path, value } of changes) {
    if (value === undefined) doc.deleteIn(path);
    else doc.setIn(path, value);
  }
  return doc.toString({ lineWidth: 0, flowCollectionPadding: false });
}

/**
 * Apply field changes. Changes whose value equals the current value are ignored.
 * Returns the original text when nothing changed.
 */
export function applyFrontmatter(yaml: string, requested: FieldChange[]): { yaml: string; changed: string[] } {
  for (const c of requested) if (!isSafeFieldPath(c.path)) throw new Error(`Invalid field name: ${String(c.path)}`);
  const original = readFrontmatter(yaml);
  if (original.error) throw new Error(`Frontmatter is not valid YAML: ${original.error}`);
  const changes = requested.filter((c) => {
    const cur = getPath(original.data, c.path);
    if (c.value === undefined) return cur !== undefined;
    return !deepEqual(cur, c.value);
  });
  if (!changes.length) return { yaml, changed: [] };

  const expected = structuredClone(original.data);
  for (const c of changes) setPath(expected, c.path, c.value);

  const verify = (text: string | null) => {
    if (text === null) return false;
    const r = readFrontmatter(text);
    return !r.error && deepEqual(r.data, expected);
  };
  let out = surgical(yaml, changes);
  if (!verify(out)) {
    out = fallback(yaml, changes);
    if (!verify(out)) throw new Error('Could not update frontmatter safely. Edit it in Source mode.');
  }
  return { yaml: out!, changed: changes.map((c) => c.path.join('.')) };
}
