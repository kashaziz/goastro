import { useState } from 'react';
import { api } from './api.ts';
import type { CollectionConfig, FieldConfig, FieldType, ProjectConfig } from './types.ts';

const TYPES: FieldType[] = ['text', 'textarea', 'date', 'tags', 'boolean', 'number', 'image', 'select', 'yaml'];

export function SettingsDialog({
  root,
  config,
  onClose,
  onSaved,
}: {
  root: string;
  config: ProjectConfig;
  onClose: () => void;
  onSaved: (c: ProjectConfig) => void;
}) {
  const [cfg, setCfg] = useState<ProjectConfig>(() => structuredClone(config));
  const [active, setActive] = useState(0);
  const [error, setError] = useState('');

  const col = cfg.collections[active];
  const updateCol = (patch: Partial<CollectionConfig>) =>
    setCfg({ ...cfg, collections: cfg.collections.map((c, i) => (i === active ? { ...c, ...patch } : c)) });
  const updateField = (idx: number, patch: Partial<FieldConfig>) =>
    updateCol({ fields: col.fields.map((f, i) => (i === idx ? { ...f, ...patch } : f)) });
  const moveField = (idx: number, dir: -1 | 1) => {
    const fields = [...col.fields];
    const j = idx + dir;
    if (j < 0 || j >= fields.length) return;
    [fields[idx], fields[j]] = [fields[j], fields[idx]];
    updateCol({ fields });
  };

  const save = async () => {
    try {
      await api('PUT', '/api/config', { root, config: cfg });
      onSaved(cfg);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const redetect = async () => {
    if (!confirm('Replace the current settings with freshly detected ones?')) return;
    setCfg(await api<ProjectConfig>('POST', '/api/detect', { root }));
    setActive(0);
  };

  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Project settings</h3>
        <p className="muted">
          goastro detected these settings from your project the first time you opened it. Change them only if something looks wrong.
          They are stored in goastro's own config folder. Nothing is written to your project.
        </p>
        <label>
          Dev server address (for Preview, when you start the dev server yourself)
          <input value={cfg.devServerUrl} onChange={(e) => setCfg({ ...cfg, devServerUrl: e.target.value })} />
        </label>

        <h4>Content folders</h4>
        <p className="muted">Each folder is one group in the file list. The fields below become the Metadata form for posts in that folder.</p>
        <div className="tabs">
          {cfg.collections.map((c, i) => (
            <button key={i} type="button" className={i === active ? 'on' : ''} onClick={() => setActive(i)}>
              {c.name || '(unnamed)'}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              setCfg({ ...cfg, collections: [...cfg.collections, { name: 'new', dir: 'src/content/new', urlPattern: '/{slug}/', fields: [{ key: 'title', label: 'Title', type: 'text' }] }] });
              setActive(cfg.collections.length);
            }}
          >
            + Add folder
          </button>
        </div>

        {col && (
          <div className="col-settings">
            <div className="grid3">
              <label>Name<input value={col.name} onChange={(e) => updateCol({ name: e.target.value })} /></label>
              <label>Folder (relative to project)<input value={col.dir} onChange={(e) => updateCol({ dir: e.target.value })} /></label>
              <label>
                Page URL pattern
                <input value={col.urlPattern} onChange={(e) => updateCol({ urlPattern: e.target.value })} />
              </label>
            </div>
            <p className="muted">
              URL tokens: <code>{'{slug}'}</code> (frontmatter slug, else file name), <code>{'{id}'}</code> (file path), or any frontmatter key such as <code>{'{category}'}</code>.
            </p>
            <table className="fields">
              <thead>
                <tr><th>Key</th><th>Label</th><th>Type</th><th>Options (select)</th><th /></tr>
              </thead>
              <tbody>
                {col.fields.map((f, i) => (
                  <tr key={i}>
                    <td><input value={f.key} onChange={(e) => updateField(i, { key: e.target.value })} /></td>
                    <td><input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} /></td>
                    <td>
                      <select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })}>
                        {TYPES.map((t) => <option key={t}>{t}</option>)}
                      </select>
                    </td>
                    <td>
                      <input
                        key={`${col.name}|${f.key}|${f.type}|${(f.options ?? []).join(',')}`}
                        disabled={f.type !== 'select'}
                        placeholder="draft, published"
                        defaultValue={(f.options ?? []).join(', ')}
                        onBlur={(e) => updateField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                      />
                    </td>
                    <td className="nowrap">
                      <button type="button" title="Move up" onClick={() => moveField(i, -1)}>↑</button>
                      <button type="button" title="Move down" onClick={() => moveField(i, 1)}>↓</button>
                      <button type="button" title="Remove field" onClick={() => updateCol({ fields: col.fields.filter((_, j) => j !== i) })}>×</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row">
              <button type="button" onClick={() => updateCol({ fields: [...col.fields, { key: '', label: '', type: 'text' }] })}>+ Add field</button>
              <span className="spacer" />
              <button
                type="button"
                className="danger-link"
                onClick={() => {
                  setCfg({ ...cfg, collections: cfg.collections.filter((_, i) => i !== active) });
                  setActive(0);
                }}
              >
                Remove this folder
              </button>
            </div>
          </div>
        )}
        {error && <div className="alert danger">{error}</div>}
        <div className="row-end">
          <button type="button" onClick={redetect}>Re-detect</button>
          <span className="spacer" />
          <button type="button" onClick={onClose}>Cancel</button>
          <button type="button" className="primary" onClick={save}>Save settings</button>
        </div>
      </div>
    </div>
  );
}
