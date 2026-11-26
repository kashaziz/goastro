// Load a content file into an editor model, and compose edits back into file text.
import { splitFrontmatter, readFrontmatter, applyFrontmatter, type FieldChange } from './frontmatter.ts';
import {
  buildBody,
  serializeBody,
  protectedItems,
  missingProtected,
  type Flavor,
  type PMNode,
  type ProtectedItem,
} from './markdown.ts';

interface Normalized {
  text: string;
  bom: boolean;
  crlf: boolean;
}

/** Work on LF text internally; restore BOM and CRLF on write. */
function normalize(text: string): Normalized {
  const bom = text.startsWith('﻿');
  let t = bom ? text.slice(1) : text;
  const crlf = t.includes('\r\n') && !/(^|[^\r])\n/.test(t);
  if (crlf) t = t.replace(/\r\n/g, '\n');
  return { text: t, bom, crlf };
}

function restore(t: string, n: Normalized): string {
  const body = n.crlf ? t.replace(/\n/g, '\r\n') : t;
  return (n.bom ? '﻿' : '') + body;
}

export interface BlockInfo {
  id: string;
  kind: 'prose' | 'protected';
  label: string;
  reason: string;
}

export interface EditorModel {
  flavor: Flavor;
  frontmatter: Record<string, unknown>;
  frontmatterError: string | null;
  hasFrontmatter: boolean;
  doc: PMNode; // ProseMirror document JSON
  blocks: BlockInfo[];
  parseError: string | null; // body could not be parsed: Source mode only
}

/**
 * Very large or very deeply nested bodies make the Markdown parser slow (seconds to minutes), and the
 * server has one thread. Such files open in Source view only, and the save check skips the deep parse.
 */
export const VISUAL_LIMIT = { bytes: 200_000, depth: 40 };
export function tooComplex(body: string): boolean {
  if (body.length > VISUAL_LIMIT.bytes) return true;
  // Nesting: count leading quote markers and list indentation per line.
  for (const line of body.split('\n')) {
    const lead = /^[\s>]*/.exec(line)![0];
    if ((lead.match(/>/g)?.length ?? 0) > VISUAL_LIMIT.depth || lead.replace(/>/g, '').length > VISUAL_LIMIT.depth * 4) return true;
  }
  return false;
}
const TOO_COMPLEX = 'This file is too large or too deeply nested for the visual editor. Edit it in Source view.';

export function loadModel(text: string, flavor: Flavor): EditorModel {
  const n = normalize(text);
  const split = splitFrontmatter(n.text);
  const fm = readFrontmatter(split.yaml);
  const body = tooComplex(split.body) ? { blocks: [] as ReturnType<typeof buildBody>['blocks'], parseError: TOO_COMPLEX } : buildBody(split.body, flavor);
  return {
    flavor,
    frontmatter: fm.data,
    frontmatterError: fm.error,
    hasFrontmatter: split.hasFrontmatter,
    doc: { type: 'doc', content: body.blocks.map((b) => b.pm) },
    blocks: body.blocks.map(({ id, kind, label, reason }) => ({ id, kind, label, reason })),
    parseError: body.parseError,
  };
}

export interface ComposeInput {
  nodes?: PMNode[]; // top-level editor nodes; omit to keep the body
  fields?: FieldChange[]; // frontmatter changes
}

/**
 * Build new file text from the text the editor was loaded from (baseText) plus edits.
 * With no effective edits the result is identical to baseText.
 */
export function composeText(baseText: string, flavor: Flavor, input: ComposeInput): { text: string; changedFields: string[] } {
  const n = normalize(baseText);
  const split = splitFrontmatter(n.text);
  let yaml = split.yaml;
  let changedFields: string[] = [];
  if (input.fields?.length) {
    const r = applyFrontmatter(yaml, input.fields);
    yaml = r.yaml;
    changedFields = r.changed;
  }
  let head = '';
  if (split.hasFrontmatter) head = split.open + yaml + split.close;
  else if (changedFields.length) head = '---\n' + yaml + '---\n';

  let body = split.body;
  if (input.nodes) {
    const model = buildBody(split.body, flavor);
    if (model.parseError) throw new Error('The body could not be parsed. Use Source mode for this file.');
    body = serializeBody(model, input.nodes);
  }
  return { text: restore(head + body, n), changedFields };
}

export interface Audit {
  missing: ProtectedItem[]; // protected content removed or changed
  parseError: string | null; // new text does not parse
  frontmatterError: string | null;
  note: string | null;
}

/** Compare old and new file text for lost protected content and syntax errors. */
export function auditChange(oldText: string, newText: string, flavor: Flavor): Audit {
  const before = splitFrontmatter(normalize(oldText).text);
  const after = splitFrontmatter(normalize(newText).text);
  const fm = readFrontmatter(after.yaml);
  if (tooComplex(before.body) || tooComplex(after.body))
    return { missing: [], parseError: null, frontmatterError: after.hasFrontmatter ? fm.error : null, note: 'This file is too large to check protected content. Read the diff carefully.' };
  const a = buildBody(before.body, flavor);
  const b = buildBody(after.body, flavor);
  let note: string | null = null;
  let missing: ProtectedItem[] = [];
  if (a.parseError) note = 'The original file did not parse, so protected content could not be checked.';
  else if (!b.parseError) missing = missingProtected(protectedItems(a), protectedItems(b));
  return {
    missing,
    parseError: b.parseError,
    frontmatterError: after.hasFrontmatter ? fm.error : null,
    note,
  };
}
