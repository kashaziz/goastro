// Editor schema shared by the browser editor and the Node test suite.
// The server produces ProseMirror JSON that must match these node names.
import { Extension, Node, type AnyExtension, type NodeViewRenderer } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Code from '@tiptap/extension-code';

/** Top-level node types that carry a blockId linking them to the original source. */
export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'blockquote',
  'horizontalRule',
  'protectedBlock',
];

const BlockAttrs = Extension.create({
  name: 'blockAttrs',
  addGlobalAttributes() {
    return [
      {
        types: BLOCK_TYPES,
        attributes: {
          // keepOnSplit=false: splitting a paragraph must not duplicate its identity.
          blockId: { default: null, keepOnSplit: false, rendered: false },
        },
      },
      {
        types: ['bulletList', 'orderedList', 'listItem'],
        attributes: { spread: { default: false, rendered: false } },
      },
      {
        types: ['bulletList'],
        attributes: { bullet: { default: '-', rendered: false } },
      },
      {
        types: ['link'],
        attributes: { title: { default: null } },
      },
    ];
  },
});

/** A block the visual editor cannot represent. Its source is kept verbatim. */
export const ProtectedBlock = Node.create({
  name: 'protectedBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,
  addAttributes() {
    return {
      source: {
        default: '',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-source') ?? '',
      },
      label: {
        default: 'Source',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-label') ?? 'Source',
      },
      reason: { default: '', rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-protected-block]' }];
  },
  renderHTML({ node }) {
    return [
      'div',
      { 'data-protected-block': '', 'data-source': node.attrs.source, 'data-label': node.attrs.label },
      ['pre', {}, node.attrs.source],
    ];
  },
});

/** Inline MDX/HTML (for example <Foo />, {expr}, {/* comment *\/}) kept verbatim inside prose. */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      source: {
        default: '',
        rendered: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-source') ?? '',
      },
      label: { default: 'MDX', rendered: false },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-raw-inline]' }];
  },
  renderHTML({ node }) {
    return ['span', { 'data-raw-inline': '', 'data-source': node.attrs.source }, node.attrs.source];
  },
});

let assetUrl: (src: string) => string = (src) => src;
/** The browser sets this so images resolve against the open project. */
export function setAssetResolver(fn: (src: string) => string) {
  assetUrl = fn;
}

const MarkdownImage = Image.extend({
  addAttributes() {
    return {
      src: {
        default: null,
        // Display through the tool's asset route, but keep the original path in the document.
        parseHTML: (el: HTMLElement) => el.getAttribute('data-src') ?? el.getAttribute('src'),
        renderHTML: (attrs: Record<string, unknown>) => ({
          src: attrs.src ? assetUrl(String(attrs.src)) : null,
          'data-src': attrs.src,
        }),
      },
      alt: { default: null },
      title: { default: null },
    };
  },
}).configure({ inline: true, allowBase64: false });

export interface NodeViews {
  protectedBlock?: NodeViewRenderer;
  rawInline?: NodeViewRenderer;
}

export function createExtensions(views: NodeViews = {}): AnyExtension[] {
  return [
    StarterKit.configure({
      codeBlock: false,
      code: false,
      underline: false,
      trailingNode: false,
      link: { openOnClick: false, autolink: false, linkOnPaste: true, HTMLAttributes: { target: null, rel: null } },
    }),
    // Allow code inside links and bold, as Markdown does.
    Code.extend({ excludes: '' }),
    MarkdownImage,
    BlockAttrs,
    views.protectedBlock
      ? ProtectedBlock.extend({ addNodeView: () => views.protectedBlock! })
      : ProtectedBlock,
    views.rawInline ? RawInline.extend({ addNodeView: () => views.rawInline! }) : RawInline,
  ];
}
