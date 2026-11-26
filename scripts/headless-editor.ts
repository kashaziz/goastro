// Runs the real TipTap editor schema in Node (via jsdom) for tests and verification.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
const g = globalThis as Record<string, unknown>;
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Element', 'getComputedStyle', 'MutationObserver', 'DOMParser', 'requestAnimationFrame', 'cancelAnimationFrame', 'KeyboardEvent', 'MouseEvent', 'ClipboardEvent', 'Event', 'Text', 'Range', 'Selection']) {
  const value = (dom.window as unknown as Record<string, unknown>)[key];
  if (value !== undefined) Object.defineProperty(g, key, { value, configurable: true, writable: true });
}
// ProseMirror measures layout in some commands; jsdom has no layout.
const proto = dom.window.HTMLElement.prototype as unknown as Record<string, unknown>;
proto.getClientRects = () => [];
proto.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON() {} });
(dom.window.Range.prototype as unknown as Record<string, unknown>).getClientRects = () => [];
(dom.window.Range.prototype as unknown as Record<string, unknown>).getBoundingClientRect = proto.getBoundingClientRect;
dom.window.document.elementFromPoint = () => null;

const { Editor } = await import('@tiptap/core');
const { createExtensions } = await import('../shared/extensions.ts');

export type HeadlessEditor = InstanceType<typeof Editor>;

export function createEditor(doc: { type: string; content?: object[] }): HeadlessEditor {
  const content = doc.content && doc.content.length ? doc : { type: 'doc', content: [{ type: 'paragraph' }] };
  return new Editor({ element: document.createElement("div"), extensions: createExtensions(), content: content as never });
}
