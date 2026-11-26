import { useState } from 'react';
import { stringify as yamlStringify, parse as yamlParse } from 'yaml';
import type { FieldConfig } from './types.ts';

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function TagsInput({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const parts = draft.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length) onChange([...value, ...parts.filter((p) => !value.includes(p))]);
    setDraft('');
  };
  return (
    <div className="tags">
      {value.map((t) => (
        <span key={t} className="tag">
          {t}
          <button type="button" title={`Remove ${t}`} onClick={() => onChange(value.filter((x) => x !== t))}>×</button>
        </span>
      ))}
      <input
        value={draft}
        placeholder="Add, then press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={add}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            add();
          } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
        }}
      />
    </div>
  );
}

function YamlField({ value, onChange }: { value: unknown; onChange: (v: unknown) => void }) {
  const [text, setText] = useState(() => (value === undefined ? '' : yamlStringify(value, { lineWidth: 0 })));
  const [error, setError] = useState('');
  return (
    <>
      <textarea
        className="mono"
        rows={Math.min(14, text.split('\n').length + 1)}
        value={text}
        spellCheck={false}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(e.target.value.trim() ? yamlParse(e.target.value) : undefined);
            setError('');
          } catch (err) {
            setError((err as Error).message.split('\n')[0]);
          }
        }}
      />
      {error && <span className="error-text">YAML error: {error}</span>}
    </>
  );
}

export function MetaForm({
  fields,
  values,
  otherKeys,
  assetUrl,
  images,
  onChange,
}: {
  fields: FieldConfig[];
  values: Record<string, unknown>;
  otherKeys: string[];
  assetUrl: (src: string) => string;
  images: string[];
  onChange: (key: string, value: unknown) => void;
}) {
  return (
    <div className="meta-grid">
      {fields.map((f) => {
        const v = values[f.key];
        const str = v === undefined || v === null ? '' : String(v);
        let input: React.ReactNode;
        switch (f.type) {
          case 'textarea':
            input = (
              <>
                <textarea rows={3} value={str} onChange={(e) => onChange(f.key, e.target.value)} />
                <span className="count">{str.length} characters</span>
              </>
            );
            break;
          case 'date':
            input =
              str === '' || ISO_DAY.test(str) ? (
                <input type="date" value={str} onChange={(e) => onChange(f.key, e.target.value)} />
              ) : (
                <input value={str} onChange={(e) => onChange(f.key, e.target.value)} />
              );
            break;
          case 'tags':
            input = <TagsInput value={Array.isArray(v) ? v.map(String) : []} onChange={(t) => onChange(f.key, t)} />;
            break;
          case 'boolean':
            input = <input type="checkbox" checked={v === true} onChange={(e) => onChange(f.key, e.target.checked)} />;
            break;
          case 'number':
            input = (
              <input
                type="number"
                value={str}
                onChange={(e) => onChange(f.key, e.target.value === '' ? '' : Number(e.target.value))}
              />
            );
            break;
          case 'image':
            input = (
              <div className="image-field">
                <input list="ace-images-meta" value={str} onChange={(e) => onChange(f.key, e.target.value)} />
                {str && <img src={assetUrl(str)} alt="" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} />}
              </div>
            );
            break;
          case 'select': {
            const opts = [...new Set([...(f.options ?? []), ...(str ? [str] : [])])];
            input = (
              <select value={str} onChange={(e) => onChange(f.key, e.target.value)}>
                <option value="">(not set)</option>
                {opts.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            );
            break;
          }
          case 'yaml':
            input = <YamlField value={v} onChange={(x) => onChange(f.key, x)} />;
            break;
          default:
            input = <input value={str} onChange={(e) => onChange(f.key, e.target.value)} />;
        }
        return (
          <label key={f.key} className={`field field-${f.type}`}>
            <span className="field-label">
              {f.label} <code>{f.key}</code>
            </span>
            {input}
          </label>
        );
      })}
      <datalist id="ace-images-meta">{images.map((i) => <option key={i} value={i} />)}</datalist>
      {otherKeys.length > 0 && (
        <p className="muted other-keys">
          Other frontmatter keys are kept as they are: {otherKeys.join(', ')}. Add them in Settings, or edit them in Source mode.
        </p>
      )}
    </div>
  );
}
