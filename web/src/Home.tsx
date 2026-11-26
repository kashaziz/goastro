import { useCallback, useEffect, useState } from 'react';
import { api } from './api.ts';
import { ThemeToggle, Wordmark, shortPath } from './Brand.tsx';

interface ProjectSummary {
  root: string;
  name: string;
  kind: 'astro' | 'markdown';
  recent: boolean;
}

interface GlobalSettings {
  projectDirs: string[];
  port: number;
  idleMinutes: number;
}

interface SettingsResponse {
  saved: GlobalSettings;
  effective: GlobalSettings;
  overridden: (keyof GlobalSettings)[];
  hidden: number;
  runningPort: number | null;
}

// ---------- home page ----------

export function Home({
  onOpen,
  error,
  ask,
  onAskCancel,
}: {
  onOpen: (root: string) => void;
  error: string;
  ask?: string | null; // a project link to confirm before opening
  onAskCancel?: () => void;
}) {
  const [path, setPath] = useState('');
  const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
  const [home, setHome] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const load = useCallback(() => {
    api<{ projects: ProjectSummary[]; home: string }>('GET', '/api/projects')
      .then((r) => {
        setProjects(r.projects);
        setHome(r.home);
      })
      .catch(() => setProjects([]));
  }, []);
  useEffect(load, [load]);

  const recent = projects?.filter((p) => p.recent) ?? [];
  const found = projects?.filter((p) => !p.recent) ?? [];

  const hide = async (root: string) => {
    setProjects((list) => list?.filter((x) => x.root !== root) ?? null);
    await api('POST', '/api/projects/hide', { root }).catch(() => load());
  };

  const Card = ({ p }: { p: ProjectSummary }) => (
    <div className="project-card">
      <button type="button" className="pc-open" onClick={() => onOpen(p.root)} title={p.root}>
        <span className="pc-head">
          <span className="pc-name">{p.name}</span>
          <span className={`kind kind-${p.kind}`}>{p.kind === 'astro' ? 'Astro' : 'Markdown'}</span>
        </span>
        <span className="pc-path">{shortPath(p.root, home)}</span>
      </button>
      <button
        type="button"
        className="pc-hide"
        title="Remove from this page. The project itself is not changed."
        aria-label={`Remove ${p.name} from this page`}
        onClick={() => hide(p.root)}
      >
        ×
      </button>
    </div>
  );

  return (
    <div className="home">
      <header className="topbar">
        <Wordmark />
        <span className="spacer" />
        <button type="button" onClick={() => setSettingsOpen(true)}>Settings</button>
        <ThemeToggle />
      </header>

      <section className="hero">
        <span className="wordmark hero-mark" aria-hidden="true">
          <span className="go">go</span>astro
        </span>
        <h1>Write your Astro posts visually.</h1>
        <p className="lede">Markdown and MDX stay safe. Components are kept exactly as written, and you see every change before it is saved.</p>
        <form
          className="open-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (path.trim()) onOpen(path.trim());
          }}
        >
          <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="Project folder name (my-blog) or path (~/work/my-blog)" autoFocus />
          <button className="primary" type="submit">Open</button>
        </form>
        {ask && (
          <div className="alert ask">
            <span>
              A link asks to open <code>{ask}</code>. Open it?
            </span>
            <span className="row-end" style={{ marginTop: 0 }}>
              <button type="button" onClick={onAskCancel}>Cancel</button>
              <button type="button" className="primary" onClick={() => onOpen(ask)}>Open project</button>
            </span>
          </div>
        )}
        {error && <div className="alert danger">{error}</div>}
      </section>

      <section className="projects">
        {projects === null && <p className="muted">Looking for projects…</p>}
        {recent.length > 0 && (
          <>
            <h2>Recent</h2>
            <div className="card-grid">{recent.map((p) => <Card key={p.root} p={p} />)}</div>
          </>
        )}
        {found.length > 0 && (
          <>
            <h2>Astro projects in your project folders</h2>
            <div className="card-grid">{found.map((p) => <Card key={p.root} p={p} />)}</div>
          </>
        )}
        {projects !== null && projects.length === 0 && (
          <div className="empty-card">
            <p>No projects found yet.</p>
            <p className="muted">
              Type a folder above, or add the folders where you keep your projects in{' '}
              <button type="button" className="link-btn inline" onClick={() => setSettingsOpen(true)}>Settings</button>.
            </p>
          </div>
        )}
      </section>

      <footer className="home-foot muted">
        Tip: run <code>goastro</code> inside a project folder to open it directly. Run <code>goastro stop</code> to stop the editor.
      </footer>

      {settingsOpen && (
        <GlobalSettingsDialog
          home={home}
          onClose={() => setSettingsOpen(false)}
          onSaved={() => {
            setSettingsOpen(false);
            load();
          }}
        />
      )}
    </div>
  );
}

// ---------- global settings ----------

function GlobalSettingsDialog({ home, onClose, onSaved }: { home: string | null; onClose: () => void; onSaved: () => void }) {
  const [data, setData] = useState<SettingsResponse | null>(null);
  const [dirs, setDirs] = useState<string[]>([]);
  const [port, setPort] = useState('');
  const [idle, setIdle] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    api<SettingsResponse>('GET', '/api/settings')
      .then((r) => {
        setData(r);
        setDirs(r.saved.projectDirs.length ? r.saved.projectDirs : ['']);
        setPort(String(r.saved.port));
        setIdle(String(r.saved.idleMinutes));
      })
      .catch((e) => setError((e as Error).message));
  }, []);

  const save = async () => {
    try {
      setError('');
      await api('PUT', '/api/settings', { projectDirs: dirs, port: Number(port), idleMinutes: Number(idle) });
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const over = (k: keyof GlobalSettings) =>
    data?.overridden.includes(k) ? (
      <span className="note">An environment variable overrides this now: {String(k === 'projectDirs' ? data.effective.projectDirs.join(':') : data.effective[k])}</span>
    ) : null;

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 640 }} onClick={(e) => e.stopPropagation()}>
        <h3>goastro settings</h3>
        {!data && !error && <p className="muted">Loading…</p>}
        {data && (
          <>
            <div className="setting">
              <div className="setting-label">
                <strong>Project folders</strong>
                <span className="muted">goastro looks for projects here, and up to two levels inside. A bare name such as <code>my-blog</code> is found in these folders.</span>
              </div>
              {dirs.map((d, i) => (
                <div className="dir-row" key={i}>
                  <input
                    value={d}
                    placeholder={home ? '~/work' : '/path/to/projects'}
                    onChange={(e) => setDirs(dirs.map((x, j) => (j === i ? e.target.value : x)))}
                  />
                  <button type="button" title="Remove this folder" onClick={() => setDirs(dirs.filter((_, j) => j !== i))}>×</button>
                </div>
              ))}
              <button type="button" onClick={() => setDirs([...dirs, ''])}>+ Add folder</button>
              {over('projectDirs')}
            </div>

            <div className="setting two">
              <label>
                <strong>Editor port</strong>
                <input type="number" min={1024} max={65535} value={port} onChange={(e) => setPort(e.target.value)} />
                <span className="muted">
                  Applies the next time goastro starts.
                  {data.runningPort && Number(port) !== data.runningPort ? ` It runs on ${data.runningPort} now. Run goastro stop, then goastro.` : ''}
                </span>
                {over('port')}
              </label>
              <label>
                <strong>Stop unused dev servers after</strong>
                <span className="with-unit">
                  <input type="number" min={1} max={1440} value={idle} onChange={(e) => setIdle(e.target.value)} />
                  <span className="muted">minutes</span>
                </span>
                <span className="muted">Counts the time with no Preview open. Applies at once.</span>
                {over('idleMinutes')}
              </label>
            </div>
            {data.hidden > 0 && (
              <div className="setting">
                <div className="setting-label">
                  <strong>Hidden projects</strong>
                  <span className="muted">{data.hidden} project{data.hidden === 1 ? ' is' : 's are'} removed from the home page.</span>
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    await api('POST', '/api/projects/unhide-all');
                    setData({ ...data, hidden: 0 });
                  }}
                >
                  Show them again
                </button>
              </div>
            )}
            <p className="muted">Stored in <code>~/.config/goastro/projects.json</code>.</p>
          </>
        )}
        {error && <div className="alert danger">{error}</div>}
        <div className="row-end">
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={save} disabled={!data}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
