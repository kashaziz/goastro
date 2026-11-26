import { useEffect, useState } from 'react';
import { EditorContent, NodeViewWrapper, ReactNodeViewRenderer, useEditor, useEditorState, type Editor, type NodeViewProps } from '@tiptap/react';
import { createExtensions } from '../../shared/extensions.ts';
import type { PMNode } from './types.ts';

// ---------- node views ----------

function ProtectedView({ node, updateAttributes, deleteNode, selected }: NodeViewProps) {
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const source = String(node.attrs.source ?? '');
  const lines = source.split('\n');
  const long = lines.length > 8;
  return (
    <NodeViewWrapper className={`protected ${selected ? 'is-selected' : ''}`} data-drag-handle="">
      <div className="protected-head" contentEditable={false}>
        <span className="lock" aria-hidden>🔒</span>
        <strong>{node.attrs.label}</strong>
        <span className="muted" title={String(node.attrs.reason ?? '')}>
          Protected. Kept exactly as written.
        </span>
        <span className="spacer" />
        <button type="button" onClick={() => setEditing(!editing)}>{editing ? 'Done' : 'Edit source'}</button>
        <button
          type="button"
          className="danger-link"
          onClick={() => {
            if (confirm(`Remove this ${node.attrs.label} block? You will see a warning before saving.`)) deleteNode();
          }}
        >
          Remove
        </button>
      </div>
      {editing ? (
        <div contentEditable={false}>
          <p className="warn-inline">
            You are editing raw {node.attrs.label} source. Keep the syntax valid, or the page can break.
          </p>
          <textarea
            className="source-area"
            spellCheck={false}
            value={source}
            rows={Math.min(30, lines.length + 1)}
            onChange={(e) => updateAttributes({ source: e.target.value })}
          />
        </div>
      ) : (
        <pre contentEditable={false} className="protected-src">
          {long && !expanded ? lines.slice(0, 6).join('\n') + '\n…' : source}
          {long && (
            <button type="button" className="link-btn" onClick={() => setExpanded(!expanded)}>
              {expanded ? 'Show less' : `Show all ${lines.length} lines`}
            </button>
          )}
        </pre>
      )}
    </NodeViewWrapper>
  );
}

function RawInlineView({ node, updateAttributes }: NodeViewProps) {
  const source = String(node.attrs.source ?? '');
  const short = source.replace(/\s+/g, ' ');
  return (
    <NodeViewWrapper
      as="span"
      className="raw-inline"
      title={`${node.attrs.label} (protected). Double-click to edit the source.\n\n${source}`}
      onDoubleClick={() => {
        const next = prompt(`Edit ${node.attrs.label} source`, source);
        if (next !== null && next !== source) updateAttributes({ source: next });
      }}
    >
      {short.length > 40 ? short.slice(0, 39) + '…' : short}
    </NodeViewWrapper>
  );
}

export const extensions = createExtensions({
  protectedBlock: ReactNodeViewRenderer(ProtectedView),
  rawInline: ReactNodeViewRenderer(RawInlineView),
});

// ---------- toolbar ----------

function Toolbar({ editor, onImage }: { editor: Editor; onImage: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      block: e.isActive('heading', { level: 1 })
        ? 'h1'
        : e.isActive('heading', { level: 2 })
          ? 'h2'
          : e.isActive('heading', { level: 3 })
            ? 'h3'
            : e.isActive('heading', { level: 4 })
              ? 'h4'
              : 'p',
      bold: e.isActive('bold'),
      italic: e.isActive('italic'),
      code: e.isActive('code'),
      strike: e.isActive('strike'),
      link: e.isActive('link'),
      bullet: e.isActive('bulletList'),
      ordered: e.isActive('orderedList'),
      quote: e.isActive('blockquote'),
      canUndo: e.can().undo(),
      canRedo: e.can().redo(),
    }),
  });
  const chain = () => editor.chain().focus();
  const setLink = () => {
    const prev = String(editor.getAttributes('link').href ?? '');
    const href = prompt('Link address (leave empty to remove the link)', prev);
    if (href === null) return;
    if (href.trim() === '') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: href.trim() }).run();
  };
  const B = (p: { on?: boolean; title: string; onClick: () => void; children: React.ReactNode; disabled?: boolean }) => (
    <button type="button" className={p.on ? 'on' : ''} title={p.title} onClick={p.onClick} disabled={p.disabled}>
      {p.children}
    </button>
  );
  return (
    <div className="toolbar">
      <select
        value={s.block}
        title="Text style"
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') chain().setParagraph().run();
          else chain().setHeading({ level: Number(v.slice(1)) as 1 | 2 | 3 | 4 }).run();
        }}
      >
        <option value="p">Paragraph</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
        <option value="h4">Heading 4</option>
      </select>
      <B on={s.bold} title="Bold (Ctrl+B)" onClick={() => chain().toggleBold().run()}><b>B</b></B>
      <B on={s.italic} title="Italic (Ctrl+I)" onClick={() => chain().toggleItalic().run()}><i>I</i></B>
      <B on={s.strike} title="Strikethrough" onClick={() => chain().toggleStrike().run()}><s>S</s></B>
      <B on={s.code} title="Inline code" onClick={() => chain().toggleCode().run()}>{'</>'}</B>
      <B on={s.link} title="Add or edit link" onClick={setLink}>Link</B>
      <span className="sep" />
      <B on={s.bullet} title="Bullet list" onClick={() => chain().toggleBulletList().run()}>• List</B>
      <B on={s.ordered} title="Numbered list" onClick={() => chain().toggleOrderedList().run()}>1. List</B>
      <B on={s.quote} title="Quote" onClick={() => chain().toggleBlockquote().run()}>❝ Quote</B>
      <B title="Insert image" onClick={onImage}>Image</B>
      <B title="Horizontal line" onClick={() => chain().setHorizontalRule().run()}>―</B>
      <span className="sep" />
      <B title="Undo (Ctrl+Z)" onClick={() => chain().undo().run()} disabled={!s.canUndo}>↶</B>
      <B title="Redo (Ctrl+Shift+Z)" onClick={() => chain().redo().run()} disabled={!s.canRedo}>↷</B>
    </div>
  );
}

// ---------- image dialog ----------

function ImageDialog({ images, onClose, onInsert }: { images: string[]; onClose: () => void; onInsert: (src: string, alt: string) => void }) {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal small" onClick={(e) => e.stopPropagation()}>
        <h3>Insert image</h3>
        <label>
          Image path or URL
          <input list="goastro-images" value={src} onChange={(e) => setSrc(e.target.value)} placeholder="/images/photo.webp" autoFocus />
        </label>
        <datalist id="goastro-images">{images.map((i) => <option key={i} value={i} />)}</datalist>
        <label>
          Alt text (describes the image)
          <input value={alt} onChange={(e) => setAlt(e.target.value)} />
        </label>
        <p className="muted">Paths that start with / come from the project's public folder.</p>
        <div className="row-end">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" disabled={!src.trim()} onClick={() => onInsert(src.trim(), alt.trim())}>
            Insert
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- editor ----------

export function VisualEditor({
  doc,
  docKey,
  images,
  onChange,
  onReady,
}: {
  doc: PMNode;
  docKey: string;
  images: string[];
  onChange: () => void;
  onReady: (e: Editor) => void;
}) {
  const [imageOpen, setImageOpen] = useState(false);
  const editor = useEditor({
    extensions,
    content: withContent(doc),
    onUpdate: () => onChange(),
    editorProps: {
      attributes: { class: 'prose', spellcheck: 'true' },
      // Double-click an image to change its path or alt text.
      handleDoubleClickOn: (view, pos, node) => {
        if (node.type.name !== 'image') return false;
        const src = prompt('Image path or URL', String(node.attrs.src ?? ''));
        if (src === null) return true;
        const alt = prompt('Alt text', String(node.attrs.alt ?? ''));
        if (alt === null) return true;
        view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: src.trim(), alt: alt.trim() || null }));
        return true;
      },
    },
  });

  // Load a new document without recording it as an edit.
  useEffect(() => {
    if (!editor) return;
    // Not an edit: keep it out of the undo history, so Ctrl+Z never brings back another file.
    editor.chain().setMeta('addToHistory', false).setContent(withContent(doc), { emitUpdate: false }).run();
    onReady(editor);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, docKey]);

  if (!editor) return null;
  return (
    <div className="editor-wrap">
      <Toolbar editor={editor} onImage={() => setImageOpen(true)} />
      <EditorContent editor={editor} />
      {imageOpen && (
        <ImageDialog
          images={images}
          onClose={() => setImageOpen(false)}
          onInsert={(src, alt) => {
            editor.chain().focus().insertContent({ type: 'image', attrs: { src, alt: alt || null } }).run();
            setImageOpen(false);
          }}
        />
      )}
    </div>
  );
}

function withContent(doc: PMNode): PMNode {
  return doc.content && doc.content.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };
}
