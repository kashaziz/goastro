import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@tiptap/react';
import { api, q, UNAUTHORIZED_EVENT } from './api.ts';
import { VisualEditor } from './Editor.tsx';
import { MetaForm } from './MetaForm.tsx';
import { ReviewDialog } from './ReviewDialog.tsx';
import { SettingsDialog } from './SettingsDialog.tsx';
import { setAssetResolver } from '../../shared/extensions.ts';
import { Home } from './Home.tsx';
import { ThemeToggle, Wordmark } from './Brand.tsx';
import { getPath, type CollectionFiles, type ComposeResponse, type DocResponse, type EditorModel, type ProjectConfig } from './types.ts';

type Mode = 'visual' | 'source' | 'preview';

interface DevInfo {
  url: string | null;
  state: 'starting' | 'running' | 'exited';
  log: string[];
  exitCode: number | null;
}
interface DevStatus {
  managed: DevInfo | null; // a dev server the editor started
  external: boolean; // a dev server you started yourself answers on the configured URL
  canStart?: boolean; // the project has a "dev" script
}

const readPref = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? '1' : '0');
  } catch {
    // storage blocked
  }
};

/** Put the page path of `previewUrl` on the dev server that the editor started. */
function previewSrc(previewUrl: string, dev: DevStatus | null): string | null {
  if (!dev) return null;
  try {
    if (dev.managed?.state === 'running' && dev.managed.url) {
      const u = new URL(previewUrl);
      return dev.managed.url.replace(/\/$/, '') + u.pathname + u.search + u.hash;
    }
    return dev.external ? new URL(previewUrl).href : null;
  } catch {
    return null; // an invalid dev server address in Project settings
  }
}

interface OpenDoc extends DocResponse {
  baseText: string; // text the visual editor was built from
  loadKey: string; // changes whenever the editor content is replaced
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function initialValues(model: EditorModel, fields: { key: string }[]) {
  const v: Record<string, unknown> = {};
  for (const f of fields) v[f.key] = getPath(model.frontmatter, f.key);
  return v;
}

// ---------- main app ----------

export function App() {
  const [root, setRoot] = useState<string | null>(null);
  const [kind, setKind] = useState<'astro' | 'markdown'>('astro');
  const [sidebar, setSidebar] = useState(() => readPref('goastro-sidebar', true));
  const [focus, setFocus] = useState(false);
  const [config, setConfig] = useState<ProjectConfig | null>(null);
  const [collections, setCollections] = useState<CollectionFiles[]>([]);
  const [images, setImages] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [openError, setOpenError] = useState('');
  const [doc, setDoc] = useState<OpenDoc | null>(null);
  const [mode, setMode] = useState<Mode>('visual');
  // Which editor holds the current text: the visual editor or the source text. Preview never changes it.
  const [editing, setEditing] = useState<'visual' | 'source'>('visual');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [sourceText, setSourceText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [review, setReview] = useState<ComposeResponse | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [metaOpen, setMetaOpen] = useState(() => readPref('goastro-meta', true));
  const [dev, setDev] = useState<DevStatus | null>(null);
  const [devBusy, setDevBusy] = useState(false);
  const [previewNonce, setPreviewNonce] = useState(0);
  const [reachable, setReachable] = useState<string | null>(null); // the preview URL the browser could reach
  const editorRef = useRef<Editor | null>(null);

  const assetUrl = useCallback(
    (src: string) => (/^(https?:)?\/\//.test(src) || src.startsWith('data:') ? src : `/api/asset?${q({ root: root ?? '', path: doc?.path ?? '', src })}`),
    [root, doc?.path],
  );
  // Set during render, not in an effect: the editor below is created during render and resolves its images at once.
  setAssetResolver(assetUrl);

  const refreshFiles = useCallback(async (r: string) => {
    const res = await api<{ collections: CollectionFiles[] }>('GET', `/api/files?${q({ root: r })}`);
    setCollections(res.collections);
  }, []);

  const [unauthorized, setUnauthorized] = useState(false);
  // Tell goastro that this tab is open. With no open tab for 3 minutes, goastro stops its dev server.
  useEffect(() => {
    if (unauthorized) return;
    const beat = () => api('POST', '/api/heartbeat').catch(() => {});
    beat();
    const t = setInterval(beat, 30_000);
    return () => clearInterval(t);
  }, [unauthorized]);
  const [askOpen, setAskOpen] = useState<string | null>(null); // a ?project= link that was not opened by goastro itself
  useEffect(() => {
    const h = () => setUnauthorized(true);
    window.addEventListener(UNAUTHORIZED_EVENT, h);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, h);
  }, []);

  /** Open a project by path (your click), or by a one-time ticket from the goastro command's link. */
  const openProject = useCallback(
    async (path: string, ticket?: string) => {
      try {
        setOpenError('');
        setAskOpen(null);
        const res = await api<{ root: string; kind: 'astro' | 'markdown'; config: ProjectConfig }>('POST', '/api/open', ticket ? { ticket } : { root: path });
        try {
          sessionStorage.setItem('goastro-open', res.root); // a reload of this tab may reopen it without asking
        } catch {
          // storage blocked
        }
        setDirty(false);
        setRoot(res.root);
        setKind(res.kind);
        setConfig(res.config);
        setDoc(null);
        setDev(null);
        history.replaceState(null, '', `?${q({ project: res.root })}`);
        await refreshFiles(res.root);
        api<{ images: string[] }>('GET', `/api/images?${q({ root: res.root })}`).then((r) => setImages(r.images)).catch(() => {});
      } catch (e) {
        setOpenError((e as Error).message);
      }
    },
    [refreshFiles],
  );

  // Links: ?open=<ticket> comes from the goastro command and opens at once. A reload of a tab reopens its own
  // project. Any other ?project= link (it may come from another website) only asks first.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const ticket = params.get('open');
    const p = params.get('project');
    let last: string | null = null;
    try {
      last = sessionStorage.getItem('goastro-open');
    } catch {
      // storage blocked
    }
    if (ticket) openProject('', ticket);
    else if (p && p === last) openProject(p);
    else if (p) setAskOpen(p);
  }, [openProject]);

  // Warn before closing the tab with unsaved work.
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const applyLoaded = (d: DocResponse, baseText: string, model: EditorModel) => {
    const next: OpenDoc = { ...d, model, baseText, loadKey: `${d.path}:${Date.now()}` };
    setDoc(next);
    setValues(initialValues(model, d.fields));
    setTouched(new Set());
    setSourceText(baseText);
    setDirty(false);
    if (model.parseError) {
      setEditing('source');
      setMode((m) => (m === 'preview' ? m : 'source'));
    }
  };

  /** After loading a file that the visual editor can show, leave Source for Write. */
  const preferVisual = (model: EditorModel) => {
    if (model.parseError) return;
    setEditing('visual');
    setMode((m) => (m === 'source' ? 'visual' : m));
  };

  const openFile = async (path: string) => {
    if (dirty && !confirm('You have unsaved changes. Discard them?')) return;
    try {
      setError('');
      const d = await api<DocResponse>('GET', `/api/doc?${q({ root: root!, path })}`);
      applyLoaded(d, d.text, d.model);
      preferVisual(d.model);
      setStatus('');
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const fieldChanges = () => {
    if (!doc) return [];
    const init = initialValues(doc.model, doc.fields);
    const typeOf = new Map(doc.fields.map((f) => [f.key, f.type]));
    return [...touched]
      .map((key) => {
        let v = values[key];
        // An emptied field is removed. Only a text field that the file already had keeps an empty "" value:
        // an empty date, choice, image or number would fail an Astro schema.
        const keepEmpty = (typeOf.get(key) === 'text' || typeOf.get(key) === 'textarea') && typeof init[key] === 'string';
        if ((v === '' && !keepEmpty) || (typeof v === 'number' && Number.isNaN(v))) v = undefined;
        return { key, v, init: init[key] };
      })
      .filter(({ v, init }) => !same(v, init) && !(init === undefined && v === false))
      .map(({ key, v }) => ({ path: key.split('.'), value: v }));
  };

  const compose = async (): Promise<ComposeResponse> => {
    const body: Record<string, unknown> = { root, path: doc!.path, diskHash: doc!.hash };
    if (editing === 'source') body.sourceText = sourceText;
    else {
      body.baseText = doc!.baseText;
      body.nodes = editorRef.current?.getJSON().content ?? [];
      body.fields = fieldChanges();
    }
    return api<ComposeResponse>('POST', '/api/compose', body);
  };

  const openReview = async () => {
    if (!doc) return;
    try {
      setError('');
      setReview(await compose());
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const save = async (confirmWarnings: boolean) => {
    if (!review || !doc) return;
    setSaving(true);
    try {
      const r = await api<{ saved: boolean; backupPath?: string }>('POST', '/api/save', {
        root,
        path: doc.path,
        diskHash: doc.hash,
        newText: review.newText,
        confirmWarnings,
      });
      setReview(null);
      const d = await api<DocResponse>('GET', `/api/doc?${q({ root: root!, path: doc.path })}`);
      applyLoaded(d, d.text, d.model);
      if (editing === 'visual') preferVisual(d.model); // saving from Source stays in Source
      setStatus(r.saved ? `Saved. Backup: ${r.backupPath}` : 'No changes to save.');
      setPreviewNonce((n) => n + 1);
      refreshFiles(root!);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const switchMode = async (next: Mode) => {
    if (!doc || next === mode) return;
    // Convert between the two editors only when the editor that holds the text changes. Preview keeps it.
    const from = editing;
    const to = next === 'preview' ? editing : next;
    try {
      setError('');
      if (from === 'visual' && to === 'source') {
        // Carry visual edits into the source text.
        const r = await compose();
        setSourceText(r.newText);
      } else if (from === 'source' && to === 'visual') {
        const { model } = await api<{ model: EditorModel }>('POST', '/api/parse', { path: doc.path, text: sourceText });
        if (model.parseError) {
          setError(`This text cannot be shown visually: ${model.parseError}`);
          return;
        }
        const keepDirty = dirty || sourceText !== doc.text;
        applyLoaded(doc, sourceText, model);
        setDirty(keepDirty);
      }
      if (next === 'preview') checkDev();
      setEditing(to);
      setMode(next);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const checkDev = useCallback(async () => {
    if (!root) return;
    try {
      setDev(await api<DevStatus>('GET', `/api/dev?${q({ root })}`));
    } catch {
      setDev({ managed: null, external: false });
    }
  }, [root]);

  const startDev = async () => {
    if (!root) return;
    setDevBusy(true);
    try {
      setError('');
      const r = await api<{ managed: DevInfo }>('POST', '/api/dev/start', { root });
      setDev({ managed: r.managed, external: false, canStart: true });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDevBusy(false);
    }
  };

  const stopDev = async () => {
    if (!root) return;
    setDevBusy(true);
    try {
      await api('POST', '/api/dev/stop', { root });
      await checkDev();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDevBusy(false);
    }
  };

  // While Preview is open: poll every second during start-up, else every minute.
  // Each poll also tells the server that Preview is in use, so the idle timer does not stop the dev server.
  const devStarting = dev?.managed?.state === 'starting';
  useEffect(() => {
    if (mode !== 'preview' || !root) return;
    if (!devStarting) checkDev(); // at once, for example after opening another project while in Preview
    const t = setInterval(checkDev, devStarting ? 1000 : 60_000);
    return () => clearInterval(t);
  }, [mode, root, devStarting, checkDev]);

  useEffect(() => writePref('goastro-sidebar', sidebar), [sidebar]);
  useEffect(() => writePref('goastro-meta', metaOpen), [metaOpen]);
  useEffect(() => {
    document.title = root ? `${root.split(/[\\/]/).pop()} · goastro` : 'goastro';
  }, [root]);

  // Esc leaves focus mode. Ctrl+\ shows or hides the file list.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && focus) setFocus(false);
      if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        setSidebar((v) => !v);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [focus]);

  // The browser may reach a new dev server a moment later than goastro does (for example from Windows into WSL).
  // Probe from the browser until the page answers, then show the frame.
  const liveSrc = doc && mode === 'preview' ? previewSrc(doc.previewUrl, dev) : null;
  useEffect(() => {
    setReachable(null); // a dev server that restarts on the same address must be probed again
    if (!liveSrc) return;
    let stop = false;
    (async () => {
      const end = Date.now() + 30_000;
      while (!stop && Date.now() < end) {
        try {
          await fetch(liveSrc, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(3000) });
          if (!stop) setReachable(liveSrc);
          return;
        } catch {
          await new Promise((r) => setTimeout(r, 500));
        }
      }
      if (!stop) setReachable(liveSrc); // show the frame anyway; its own error page explains
    })();
    return () => {
      stop = true;
    };
  }, [liveSrc, previewNonce]);

  const leaveProject = () => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    setDirty(false);
    setFocus(false);
    setRoot(null);
    setDoc(null);
    setDev(null);
    history.replaceState(null, '', '/');
  };

  // Ctrl+S opens the review.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        openReview();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    return collections.map((c) => ({
      ...c,
      files: f ? c.files.filter((x) => x.title.toLowerCase().includes(f) || x.path.toLowerCase().includes(f)) : c.files,
    }));
  }, [collections, filter]);

  if (unauthorized)
    return (
      <div className="home">
        <section className="hero">
          <h1>Open goastro from your terminal</h1>
          <p className="lede">
            This tab is not signed in to goastro, or goastro has restarted. For your safety, goastro only answers the tab that its
            own command opened. Run <code>goastro</code> in your terminal to open a fresh tab.
          </p>
        </section>
      </div>
    );

  if (!root || !config)
    return (
      <Home
        onOpen={(p) => openProject(p)}
        error={openError}
        ask={askOpen}
        onAskCancel={() => {
          setAskOpen(null);
          history.replaceState(null, '', '/');
        }}
      />
    );

  const protectedCount = doc?.model.blocks.filter((b) => b.kind === 'protected').length ?? 0;
  const fmKeys = doc ? Object.keys(doc.model.frontmatter) : [];
  const configuredTop = new Set(doc?.fields.map((f) => f.key.split('.')[0]) ?? []);
  const otherKeys = fmKeys.filter((k) => !configuredTop.has(k));

  return (
    <div className={`app${sidebar ? '' : ' no-sidebar'}${focus ? ' focus' : ''}`}>
      <header className="topbar">
        <button type="button" className="icon-btn" title="Show or hide the file list (Ctrl+\\)" aria-label="Toggle file list" onClick={() => setSidebar(!sidebar)}>
          ☰
        </button>
        <Wordmark onClick={leaveProject} />
        <span className="crumb" title={root}>
          <span className="crumb-sep">/</span>
          <strong>{root.split(/[\\/]/).pop()}</strong>
          {kind === 'markdown' && <span className="kind kind-markdown">Markdown</span>}
        </span>
        <span className="spacer" />
        {dev?.managed && dev.managed.state !== 'exited' && (
          <span className="dev-badge" title={dev.managed.url ?? ''}>
            <span className="dot" /> Dev server {dev.managed.state === 'starting' ? 'starting' : 'on'}
          </span>
        )}
        <button type="button" onClick={leaveProject}>Switch project</button>
        <button type="button" onClick={() => setSettingsOpen(true)}>Project settings</button>
        <ThemeToggle />
      </header>

      <aside>
        <div className="aside-head">
          <input className="search" placeholder="Search posts" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <button type="button" className="icon-btn" title="Refresh the file list" aria-label="Refresh the file list" onClick={() => refreshFiles(root)}>↻</button>
        </div>
        {filtered.length === 0 && <p className="muted pad">No content folders configured. Open Settings to add one.</p>}
        {filtered.map((c) => (
          <details key={c.name} open>
            <summary>
              {c.name} <span className="muted">({c.files.length})</span>
            </summary>
            <ul className="files">
              {c.files.map((f) => (
                <li key={f.path}>
                  <button type="button" className={doc?.path === f.path ? 'on' : ''} onClick={() => openFile(f.path)} title={f.path}>
                    <span className="t">{f.title}</span>
                    <span className="m">
                      {f.draft && <span className="badge">draft</span>} {f.date} · {f.path.split('/').pop()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
        ))}
      </aside>

      <main>
        {!doc && (
          <div className="empty">
            <p>Choose a post on the left to start writing.</p>
            {kind === 'markdown' && (
              <p className="muted">
                This folder is not an Astro project. goastro found {collections.length ? collections.map((c) => c.dir).join(', ') : 'no content folders'}.{' '}
                <button type="button" className="link-btn inline" onClick={() => setSettingsOpen(true)}>Check the folders in Project settings</button>.
              </p>
            )}
          </div>
        )}
        {doc && (
          <>
            <div className="docbar">
              <div className="doc-title">
                <strong title={doc.path}>{typeof doc.model.frontmatter.title === 'string' && doc.model.frontmatter.title ? doc.model.frontmatter.title : doc.path}</strong>
                <span className="muted">
                  {doc.path} · {doc.model.flavor.toUpperCase()} · {doc.model.blocks.length - protectedCount} editable blocks · {protectedCount} protected
                </span>
              </div>
              <div className="segmented" role="tablist">
                {(['visual', 'source', 'preview'] as Mode[]).map((m) => (
                  <button key={m} type="button" role="tab" aria-selected={mode === m} className={mode === m ? 'on' : ''} onClick={() => switchMode(m)} disabled={m === 'visual' && !!doc.model.parseError && mode !== 'source'}>
                    {m === 'visual' ? 'Write' : m === 'source' ? 'Source' : 'Preview'}
                  </button>
                ))}
              </div>
              {mode === 'visual' && (
                <button type="button" className={focus ? 'on' : ''} title={focus ? 'Leave focus mode (Esc)' : 'Hide everything except your text'} onClick={() => setFocus(!focus)}>
                  {focus ? 'Exit focus' : 'Focus'}
                </button>
              )}
              <button type="button" className="primary" onClick={openReview} title="Review the changes, then save (Ctrl+S)">
                {dirty ? 'Review & save •' : 'Review & save'}
              </button>
            </div>
            {error && <div className="alert danger">{error}</div>}
            {status && <div className="alert ok">{status}</div>}
            {doc.model.parseError && (
              <div className="alert danger">
                This file has syntax the parser cannot read, so only Source mode is available. Error: {doc.model.parseError}
              </div>
            )}
            {doc.model.frontmatterError && <div className="alert danger">Frontmatter YAML error: {doc.model.frontmatterError}. Fix it in Source mode.</div>}

            <div style={{ display: mode === 'visual' ? 'block' : 'none' }}>
              {!doc.model.frontmatterError && doc.fields.length > 0 && (
                <section className="meta">
                  <button type="button" className="meta-toggle" onClick={() => setMetaOpen(!metaOpen)}>
                    {metaOpen ? '▾' : '▸'} Metadata
                  </button>
                  {metaOpen && (
                    <MetaForm
                      key={doc.loadKey}
                      fields={doc.fields}
                      values={values}
                      otherKeys={otherKeys}
                      assetUrl={assetUrl}
                      images={images}
                      onChange={(key, value) => {
                        setValues((v) => ({ ...v, [key]: value }));
                        setTouched((t) => new Set(t).add(key));
                        setDirty(true);
                      }}
                    />
                  )}
                </section>
              )}
              {!doc.model.parseError && (
                <VisualEditor
                  key={doc.loadKey}
                  doc={doc.model.doc}
                  docKey={doc.loadKey}
                  images={images}
                  onChange={() => setDirty(true)}
                  onReady={(e) => (editorRef.current = e)}
                />
              )}
            </div>

            {mode === 'source' && (
              <div className="source-mode">
                <p className="muted">
                  Full file source, including frontmatter. Use this for advanced MDX. Protected content is still checked before you save.
                </p>
                <textarea
                  className="source-area full"
                  spellCheck={false}
                  value={sourceText}
                  onChange={(e) => {
                    setSourceText(e.target.value);
                    setDirty(true);
                  }}
                />
              </div>
            )}

            {mode === 'preview' && (() => {
              const src = previewSrc(doc.previewUrl, dev);
              const m = dev?.managed;
              return (
                <div className="preview">
                  <div className="row">
                    <span>
                      {dev === null
                        ? 'Checking dev server…'
                        : m?.state === 'running'
                          ? '● Dev server is running (started by the editor)'
                          : m?.state === 'starting'
                            ? '◌ Starting the dev server…'
                            : dev.external
                              ? '● Dev server is running'
                              : '○ Dev server is not running.'}
                    </span>
                    {src && <a href={src} target="_blank" rel="noreferrer">{src}</a>}
                    <span className="spacer" />
                    {dev && !dev.external && dev.canStart !== false && (!m || m.state === 'exited') && (
                      <button type="button" className="primary" disabled={devBusy} onClick={startDev}>Start dev server</button>
                    )}
                    {m && m.state !== 'exited' && (
                      <button type="button" disabled={devBusy} onClick={stopDev}>Stop dev server</button>
                    )}
                    <button type="button" onClick={() => { checkDev(); setReachable(null); setPreviewNonce((n) => n + 1); }}>Reload</button>
                  </div>
                  {dev && !src && !m && dev.canStart === false && (
                    <div className="alert">
                      This project has no <code>dev</code> script, so goastro cannot start a dev server. Start it yourself, then click Reload. Set its address in Project settings.
                    </div>
                  )}
                  {dev && !src && !m && dev.canStart !== false && (
                    <div className="alert">
                      Click <strong>Start dev server</strong>. The editor runs <code>npm run dev</code> in the project folder. It stops the dev server when you close goastro, switch projects, or leave Preview unused for the idle time set on the home page (30 minutes by default).
                    </div>
                  )}
                  {m?.state === 'exited' && (
                    <div className="alert danger">The dev server stopped{m.exitCode !== null ? ` (exit code ${m.exitCode})` : ''}. Its last output is below.</div>
                  )}
                  {m && m.state !== 'running' && m.log.length > 0 && <pre className="dev-log">{m.log.join('\n')}</pre>}
                  {dirty && <div className="alert">The preview shows the saved file. Save first to see your latest edits.</div>}
                  {src && reachable !== src && <div className="alert">Waiting for the page to answer…</div>}
                  {src && reachable === src && <iframe key={previewNonce} src={src} title="Page preview" sandbox="allow-scripts allow-same-origin allow-forms allow-popups" />}
                </div>
              );
            })()}
          </>
        )}
      </main>

      {review && <ReviewDialog result={review} saving={saving} onClose={() => setReview(null)} onSave={save} />}
      {settingsOpen && (
        <SettingsDialog
          root={root}
          config={config}
          onClose={() => setSettingsOpen(false)}
          onSaved={async (c) => {
            setConfig(c);
            setSettingsOpen(false);
            await refreshFiles(root);
            if (doc) {
              const d = await api<DocResponse>('GET', `/api/doc?${q({ root, path: doc.path })}`).catch(() => null);
              if (d) {
                setDoc({ ...doc, fields: d.fields, previewUrl: d.previewUrl });
                // Fill values for newly added fields; keep the user's edits.
                const fresh = initialValues(doc.model, d.fields);
                setValues((v) => {
                  const out = { ...fresh };
                  for (const k of touched) if (k in v) out[k] = v[k];
                  return out;
                });
              }
            }
          }}
        />
      )}
    </div>
  );
}
