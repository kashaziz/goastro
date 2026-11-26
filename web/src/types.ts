export type FieldType = 'text' | 'textarea' | 'date' | 'tags' | 'boolean' | 'number' | 'image' | 'select' | 'yaml';

export interface FieldConfig {
  key: string;
  label: string;
  type: FieldType;
  options?: string[];
}

export interface CollectionConfig {
  name: string;
  dir: string;
  urlPattern: string;
  fields: FieldConfig[];
}

export interface ProjectConfig {
  devServerUrl: string;
  collections: CollectionConfig[];
}

export interface FileSummary {
  path: string;
  id: string;
  title: string;
  date: string;
  draft: boolean;
}

export interface CollectionFiles {
  name: string;
  dir: string;
  files: FileSummary[];
}

export interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
}

export interface EditorModel {
  flavor: 'md' | 'mdx';
  frontmatter: Record<string, unknown>;
  frontmatterError: string | null;
  hasFrontmatter: boolean;
  doc: PMNode;
  blocks: { id: string; kind: 'prose' | 'protected'; label: string; reason: string }[];
  parseError: string | null;
}

export interface DocResponse {
  path: string;
  text: string;
  hash: string;
  model: EditorModel;
  collection: string;
  fields: FieldConfig[];
  previewUrl: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
}

export interface ComposeResponse {
  newText: string;
  changed: boolean;
  diskChanged: boolean;
  changedFields: string[];
  audit: {
    missing: { label: string; source: string }[];
    parseError: string | null;
    frontmatterError: string | null;
    note: string | null;
  };
  hunks: Hunk[];
}

export function getPath(obj: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}
