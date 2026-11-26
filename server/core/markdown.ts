// Conversion between Markdown/MDX source, mdast and the editor's ProseMirror JSON.
//
// Safety model:
//  * The body is split into top-level blocks. Each block keeps its exact source text.
//  * A block becomes visually editable only if it converts to editor JSON and back
//    to an identical syntax tree. Anything else is a "protected" block.
//  * On save, a block the user did not change is written from its original source,
//    byte for byte. Only changed blocks are re-serialized.
import { fromMarkdown } from 'mdast-util-from-markdown';
import { toMarkdown, type Options as ToMarkdownOptions } from 'mdast-util-to-markdown';
import { mdxjs } from 'micromark-extension-mdxjs';
import { mdxFromMarkdown, mdxToMarkdown } from 'mdast-util-mdx';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown, gfmToMarkdown } from 'mdast-util-gfm';

export type Flavor = 'md' | 'mdx';

export interface PMMark {
  type: string;
  attrs?: Record<string, unknown>;
}
export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  marks?: PMMark[];
  text?: string;
}

// mdast nodes are handled structurally; a loose type keeps this file readable.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MNode = any;

class Unsupported extends Error {}

export function flavorOf(file: string): Flavor {
  return file.toLowerCase().endsWith('.mdx') ? 'mdx' : 'md';
}

export function parseBody(src: string, flavor: Flavor): MNode {
  if (flavor === 'mdx') {
    return fromMarkdown(src, {
      extensions: [mdxjs(), gfm()],
      mdastExtensions: [mdxFromMarkdown(), gfmFromMarkdown()],
    });
  }
  return fromMarkdown(src, { extensions: [gfm()], mdastExtensions: [gfmFromMarkdown()] });
}

function slice(src: string, node: MNode): string {
  return src.slice(node.position.start.offset, node.position.end.offset);
}

// ---------- labels for protected content ----------

function shorten(s: string, n = 60): string {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > n ? one.slice(0, n - 1) + '…' : one;
}

export function describe(node: MNode, src: string): string {
  switch (node.type) {
    case 'mdxjsEsm':
      return /^\s*import/.test(slice(src, node)) ? 'Import' : 'Export';
    case 'mdxJsxFlowElement':
    case 'mdxJsxTextElement':
      return node.name ? `<${node.name}>` : 'JSX fragment';
    case 'mdxFlowExpression':
    case 'mdxTextExpression':
      return /^\{\s*\/\*/.test(slice(src, node)) ? 'MDX comment' : 'Expression';
    case 'html':
      return /^<!--/.test(node.value) ? 'HTML comment' : 'HTML';
    case 'code':
      return node.lang ? `Code (${node.lang})` : 'Code block';
    case 'table':
      return 'Table';
    case 'definition':
      return 'Link definition';
    case 'footnoteDefinition':
      return 'Footnote';
    case 'footnoteReference':
      return 'Footnote ref';
    case 'linkReference':
    case 'imageReference':
      return 'Reference link';
    case 'list':
      return 'List (advanced)';
    case 'blockquote':
      return 'Quote (advanced)';
    default:
      return node.type;
  }
}

// ---------- mdast -> ProseMirror JSON ----------

const MARK_FOR: Record<string, string> = { emphasis: 'italic', strong: 'bold', delete: 'strike' };

function inlinesToPM(children: MNode[], src: string, marks: PMMark[] = []): PMNode[] {
  const out: PMNode[] = [];
  const withMarks = (n: PMNode, extra: PMMark[] = []): PMNode => {
    const all = [...marks, ...extra];
    if (all.length) n.marks = all;
    return n;
  };
  for (const c of children) {
    switch (c.type) {
      case 'text':
        if (c.value) out.push(withMarks({ type: 'text', text: c.value }));
        break;
      case 'emphasis':
      case 'strong':
      case 'delete': {
        const mark = { type: MARK_FOR[c.type] };
        if (marks.some((m) => m.type === mark.type)) throw new Unsupported('Nested formatting');
        out.push(...inlinesToPM(c.children, src, [...marks, mark]));
        break;
      }
      case 'inlineCode':
        if (c.value) out.push(withMarks({ type: 'text', text: c.value }, [{ type: 'code' }]));
        else throw new Unsupported('Empty code span');
        break;
      case 'link': {
        if (marks.some((m) => m.type === 'link')) throw new Unsupported('Nested link');
        const mark = { type: 'link', attrs: { href: c.url, title: c.title ?? null } };
        if (!c.children.length) throw new Unsupported('Empty link');
        out.push(...inlinesToPM(c.children, src, [...marks, mark]));
        break;
      }
      case 'image':
        out.push(
          withMarks({ type: 'image', attrs: { src: c.url, alt: c.alt ?? null, title: c.title ?? null } }),
        );
        break;
      case 'break':
        out.push(withMarks({ type: 'hardBreak' }));
        break;
      default:
        // Inline JSX, expressions, comments, inline HTML, reference links, footnote refs.
        out.push(
          withMarks({ type: 'rawInline', attrs: { source: slice(src, c), label: describe(c, src) } }),
        );
    }
  }
  return out;
}

function bulletChar(src: string, node: MNode): string {
  const ch = src[node.position.start.offset];
  return ch === '*' || ch === '+' ? ch : '-';
}

function blockToPM(node: MNode, src: string): PMNode {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', content: inlinesToPM(node.children, src) };
    case 'heading':
      if (!node.children.length) throw new Unsupported('Empty heading');
      return { type: 'heading', attrs: { level: node.depth }, content: inlinesToPM(node.children, src) };
    case 'thematicBreak':
      return { type: 'horizontalRule' };
    case 'blockquote':
      if (!node.children.length) throw new Unsupported('Empty quote');
      return { type: 'blockquote', content: node.children.map((c: MNode) => blockToPM(c, src)) };
    case 'list': {
      const items = node.children.map((item: MNode) => {
        if (item.checked !== null && item.checked !== undefined) throw new Unsupported('Task list');
        if (!item.children.length || item.children[0].type !== 'paragraph')
          throw new Unsupported('List item does not start with text');
        return {
          type: 'listItem',
          attrs: { spread: !!item.spread },
          content: item.children.map((c: MNode) => blockToPM(c, src)),
        };
      });
      if (node.ordered) {
        return { type: 'orderedList', attrs: { start: node.start ?? 1, spread: !!node.spread }, content: items };
      }
      return {
        type: 'bulletList',
        attrs: { spread: !!node.spread, bullet: bulletChar(src, node) },
        content: items,
      };
    }
    default:
      throw new Unsupported('Not editable visually');
  }
}

// ---------- ProseMirror JSON -> mdast ----------

const MARK_RANK: Record<string, number> = { link: 0, bold: 1, italic: 2, strike: 3 };

function markEq(a: PMMark, b: PMMark): boolean {
  if (a.type !== b.type) return false;
  if (a.type !== 'link') return true;
  return a.attrs?.href === b.attrs?.href && (a.attrs?.title ?? null) === (b.attrs?.title ?? null);
}

function markToMdast(m: PMMark): MNode {
  switch (m.type) {
    case 'link':
      return { type: 'link', url: String(m.attrs?.href ?? ''), title: (m.attrs?.title as string) || null, children: [] };
    case 'bold':
      return { type: 'strong', children: [] };
    case 'italic':
      return { type: 'emphasis', children: [] };
    case 'strike':
      return { type: 'delete', children: [] };
    default:
      return { type: 'emphasis', children: [] };
  }
}

function inlinesToMdast(input: PMNode[] = []): MNode[] {
  // A line break at the very start or end of a paragraph has no Markdown form ("text\" would show a
  // backslash). Drop it, as browsers do.
  let content = input;
  while (content.length && content[0].type === 'hardBreak') content = content.slice(1);
  while (content.length && content[content.length - 1].type === 'hardBreak') content = content.slice(0, -1);
  const root: MNode[] = [];
  let stack: { mark: PMMark; node: MNode }[] = [];
  const current = () => (stack.length ? stack[stack.length - 1].node.children : root);

  // How many consecutive items, starting at index i, carry mark m.
  const span = (i: number, m: PMMark) => {
    let n = 0;
    while (i + n < content.length && (content[i + n].marks ?? []).some((x) => markEq(x, m))) n++;
    return n;
  };

  for (const [index, item] of content.entries()) {
    // Open the mark that lasts longest first, so it becomes the outer one.
    // On a tie, formatting goes outside links: **[text](url)**.
    const marks = (item.marks ?? [])
      .filter((m) => m.type in MARK_RANK)
      .sort(
        (a, b) =>
          span(index, b) - span(index, a) ||
          (a.type === 'link' ? 1 : 0) - (b.type === 'link' ? 1 : 0) ||
          MARK_RANK[a.type] - MARK_RANK[b.type],
      );
    const isCode = (item.marks ?? []).some((m) => m.type === 'code');

    // Keep open marks that are still active; close the rest; open the new ones.
    let keep = 0;
    while (keep < stack.length && marks.some((m) => markEq(m, stack[keep].mark))) keep++;
    stack = stack.slice(0, keep);
    for (const m of marks) {
      if (stack.some((s) => markEq(s.mark, m))) continue;
      const n = markToMdast(m);
      current().push(n);
      stack.push({ mark: m, node: n });
    }

    let leaf: MNode;
    switch (item.type) {
      case 'text':
        leaf = isCode ? { type: 'inlineCode', value: item.text ?? '' } : { type: 'text', value: item.text ?? '' };
        break;
      case 'hardBreak':
        leaf = { type: 'break' };
        break;
      case 'image':
        leaf = {
          type: 'image',
          url: String(item.attrs?.src ?? ''),
          alt: (item.attrs?.alt as string) ?? '',
          title: (item.attrs?.title as string) || null,
        };
        break;
      case 'rawInline':
        // An 'html' node is printed verbatim by mdast-util-to-markdown.
        leaf = { type: 'html', value: String(item.attrs?.source ?? '') };
        break;
      default:
        leaf = { type: 'text', value: item.text ?? '' };
    }
    current().push(leaf);
  }
  return tidyInline(root);
}

/** Merge adjacent text and move edge whitespace out of emphasis, so "** bold**" never appears. */
function tidyInline(nodes: MNode[]): MNode[] {
  const out: MNode[] = [];
  const pushText = (value: string) => {
    if (!value) return;
    const last = out[out.length - 1];
    if (last && last.type === 'text') last.value += value;
    else out.push({ type: 'text', value });
  };
  for (const n of nodes) {
    if (n.type === 'text') {
      pushText(n.value);
      continue;
    }
    if (n.children) n.children = tidyInline(n.children);
    if (n.type === 'strong' || n.type === 'emphasis' || n.type === 'delete') {
      const first = n.children[0];
      let lead = '';
      let trail = '';
      if (first?.type === 'text') {
        lead = first.value.match(/^\s*/)[0];
        first.value = first.value.slice(lead.length);
      }
      const last = n.children[n.children.length - 1];
      if (last?.type === 'text') {
        trail = last.value.match(/\s*$/)[0];
        last.value = last.value.slice(0, last.value.length - trail.length);
      }
      n.children = n.children.filter((c: MNode) => !(c.type === 'text' && c.value === ''));
      pushText(lead);
      if (n.children.length) out.push(n);
      pushText(trail);
      continue;
    }
    out.push(n);
  }
  return out;
}

export function pmToMdast(node: PMNode): MNode {
  switch (node.type) {
    case 'paragraph':
      return { type: 'paragraph', children: inlinesToMdast(node.content) };
    case 'heading':
      return { type: 'heading', depth: Number(node.attrs?.level ?? 2), children: inlinesToMdast(node.content) };
    case 'horizontalRule':
      return { type: 'thematicBreak' };
    case 'blockquote':
      return { type: 'blockquote', children: (node.content ?? []).map(pmToMdast) };
    case 'bulletList':
    case 'orderedList':
      return {
        type: 'list',
        ordered: node.type === 'orderedList',
        start: node.type === 'orderedList' ? Number(node.attrs?.start ?? 1) : null,
        spread: !!node.attrs?.spread,
        children: (node.content ?? []).map((li) => ({
          type: 'listItem',
          spread: !!li.attrs?.spread,
          checked: null,
          children: (li.content ?? []).map(pmToMdast),
        })),
      };
    case 'protectedBlock':
      return { type: 'html', value: String(node.attrs?.source ?? '') };
    default:
      return { type: 'paragraph', children: inlinesToMdast(node.content) };
  }
}

/** Markdown text for one top-level editor node, without a trailing newline. */
export function nodeToMarkdown(node: PMNode, flavor: Flavor): string {
  if (node.type === 'protectedBlock') return String(node.attrs?.source ?? '');
  if (node.type === 'paragraph' && !(node.content ?? []).length) return '';
  const bullet = (node.attrs?.bullet as '-' | '*' | '+') ?? '-';
  const options: ToMarkdownOptions = {
    extensions: flavor === 'mdx' ? [mdxToMarkdown(), gfmToMarkdown()] : [gfmToMarkdown()],
    bullet,
    bulletOther: bullet === '-' ? '*' : '-',
    emphasis: '*',
    strong: '*',
    listItemIndent: 'one',
    rule: '-',
    fences: true,
  };
  return toMarkdown({ type: 'root', children: [pmToMdast(node)] }, options).replace(/\n+$/, '');
}

// ---------- round-trip verification ----------

function normalize(node: MNode): unknown {
  if (Array.isArray(node)) return node.map(normalize);
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(node).sort()) {
      if (k === 'position' || k === 'data') continue;
      const v = node[k];
      if (v === null || v === undefined) continue;
      out[k] = normalize(v);
    }
    return out;
  }
  return node;
}

export function sameTree(a: MNode, b: MNode): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function verifyRoundTrip(original: MNode, pm: PMNode, flavor: Flavor): string | null {
  let md: string;
  try {
    md = nodeToMarkdown(pm, flavor);
  } catch {
    return 'Could not be written back safely';
  }
  let tree: MNode;
  try {
    tree = parseBody(md, flavor);
  } catch {
    return 'Would not re-parse after editing';
  }
  if (tree.children.length !== 1) return 'Would split into several blocks after editing';
  if (!sameTree(tree.children[0], original)) return 'Formatting could not be preserved exactly';
  return null;
}

// ---------- document model ----------

export interface Block {
  id: string;
  gap: string; // whitespace between the previous block and this one
  source: string;
  kind: 'prose' | 'protected';
  label: string;
  reason: string;
  pm: PMNode;
  canonical: string; // nodeToMarkdown(pm) at load time
}

export interface BodyModel {
  flavor: Flavor;
  blocks: Block[];
  tail: string;
  parseError: string | null;
}

export function buildBody(body: string, flavor: Flavor): BodyModel {
  let tree: MNode;
  try {
    tree = parseBody(body, flavor);
  } catch (e) {
    return { flavor, blocks: [], tail: body, parseError: (e as Error).message };
  }
  const blocks: Block[] = [];
  let prev = 0;
  tree.children.forEach((node: MNode, i: number) => {
    const start = node.position.start.offset;
    const end = node.position.end.offset;
    const source = body.slice(start, end);
    const gap = body.slice(prev, start);
    prev = end;
    const id = `b${i}`;
    let pm: PMNode;
    let kind: Block['kind'] = 'prose';
    let reason = '';
    try {
      pm = blockToPM(node, body);
      const problem = verifyRoundTrip(node, pm, flavor);
      if (problem) throw new Unsupported(problem);
      pm.attrs = { ...(pm.attrs ?? {}), blockId: id };
    } catch (e) {
      if (!(e instanceof Unsupported)) throw e;
      kind = 'protected';
      reason = e.message;
      pm = { type: 'protectedBlock', attrs: { blockId: id, source, label: describe(node, body), reason } };
    }
    blocks.push({
      id,
      gap,
      source,
      kind,
      label: kind === 'protected' ? describe(node, body) : node.type,
      reason,
      pm,
      canonical: kind === 'prose' ? nodeToMarkdown(pm, flavor) : source,
    });
  });
  return { flavor, blocks, tail: body.slice(prev), parseError: null };
}

/**
 * Rebuild the body from editor nodes. Unchanged blocks are copied from the original
 * source; changed or new blocks are serialized.
 */
/**
 * Two lists of the same kind, written one after the other, join into one list when the file is read again.
 * Markdown keeps them apart only if the second list uses another marker: "*" after "-", or ")" after ".".
 * Returns the piece with its top-level markers changed when needed.
 */
function separateLists(prevType: string | null, prevPiece: string, type: string, piece: string): string {
  if (type !== prevType) return piece;
  if (type === 'bulletList') {
    const before = /^[-*+](?=[ \t])/m.exec(prevPiece)?.[0];
    const mine = /^[-*+](?=[ \t])/m.exec(piece)?.[0];
    if (!before || before !== mine) return piece;
    const other = before === '-' ? '*' : '-';
    return piece.replace(/^[-*+](?=[ \t])/gm, other);
  }
  if (type === 'orderedList') {
    const before = /^\d+([.)])(?=[ \t])/m.exec(prevPiece)?.[1];
    const mine = /^\d+([.)])(?=[ \t])/m.exec(piece)?.[1];
    if (!before || before !== mine) return piece;
    const other = before === '.' ? ')' : '.';
    return piece.replace(/^(\d+)[.)](?=[ \t])/gm, `$1${other}`);
  }
  return piece;
}

export function serializeBody(model: BodyModel, nodes: PMNode[]): string {
  const byId = new Map(model.blocks.map((b, i) => [b.id, { b, i }]));
  const used = new Set<string>();
  const firstGap = model.blocks[0]?.gap ?? '';
  let out = '';
  let count = 0;
  let prevIndex = -2;
  let prevType: string | null = null;
  let prevPiece = '';
  for (const node of nodes) {
    const md = nodeToMarkdown(node, model.flavor);
    if (md === '') continue; // empty paragraphs have no Markdown form
    const id = node.attrs?.blockId as string | undefined;
    const hit = id && !used.has(id) ? byId.get(id) : undefined;
    let piece = md;
    let gap = count === 0 ? firstGap : '\n\n';
    const neighbours = !!hit && count > 0 && hit.i === prevIndex + 1; // neighbours in the original file too
    if (hit) {
      used.add(id!);
      if (md === hit.b.canonical) piece = hit.b.source;
      // Keep the original spacing when this block still follows its original neighbour.
      if (count > 0 && hit.i === prevIndex + 1) gap = hit.b.gap;
      prevIndex = hit.i;
    } else {
      prevIndex = -2;
    }
    // Blocks that were neighbours in the original file are already apart. New neighbours may need a marker change.
    if (!neighbours && count > 0) piece = separateLists(prevType, prevPiece, node.type, piece);
    out += gap + piece;
    count++;
    prevType = node.type;
    prevPiece = piece;
  }
  // Keep the original ending exactly (usually one newline, sometimes none).
  if (count === 0) return model.blocks.length ? '' : model.tail;
  return out + (model.blocks.length ? model.tail : model.tail || '\n');
}

// ---------- protected-content audit ----------

export interface ProtectedItem {
  label: string;
  source: string;
}

function collectInline(nodes: PMNode[] | undefined, out: ProtectedItem[]) {
  for (const n of nodes ?? []) {
    if (n.type === 'rawInline') out.push({ label: String(n.attrs?.label ?? 'MDX'), source: String(n.attrs?.source ?? '') });
    collectInline(n.content, out);
  }
}

/** Every piece of content the visual editor does not understand, in document order. */
export function protectedItems(model: BodyModel): ProtectedItem[] {
  const out: ProtectedItem[] = [];
  for (const b of model.blocks) {
    if (b.kind === 'protected') out.push({ label: b.label, source: b.source });
    else collectInline(b.pm.content, out);
  }
  return out;
}

/** Items present before but missing (removed or changed) after. Compared by exact source. */
export function missingProtected(before: ProtectedItem[], after: ProtectedItem[]): ProtectedItem[] {
  const pool = new Map<string, number>();
  for (const a of after) pool.set(a.source, (pool.get(a.source) ?? 0) + 1);
  const missing: ProtectedItem[] = [];
  for (const b of before) {
    const n = pool.get(b.source) ?? 0;
    if (n > 0) pool.set(b.source, n - 1);
    else missing.push(b);
  }
  return missing;
}
