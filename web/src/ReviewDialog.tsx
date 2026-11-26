import { useState } from 'react';
import { diffWordsWithSpace } from 'diff';
import type { ComposeResponse, Hunk } from './types.ts';

/** Show paired removed/added lines with word-level highlights. */
function HunkView({ hunk }: { hunk: Hunk }) {
  const rows: React.ReactNode[] = [];
  const lines = hunk.lines;
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let i = 0;
  while (i < lines.length) {
    if (lines[i].startsWith('-')) {
      const removed: string[] = [];
      const added: string[] = [];
      while (i < lines.length && lines[i].startsWith('-')) removed.push(lines[i++].slice(1));
      while (i < lines.length && lines[i].startsWith('+')) added.push(lines[i++].slice(1));
      const paired = Math.min(removed.length, added.length);
      removed.forEach((text, k) => {
        const parts = k < paired ? diffWordsWithSpace(text, added[k]) : null;
        rows.push(
          <div key={`r${oldNo}`} className="dl del">
            <span className="ln">{oldNo++}</span>
            <span className="txt">
              {parts ? parts.filter((p) => !p.added).map((p, j) => <span key={j} className={p.removed ? 'hl' : ''}>{p.value}</span>) : text}
            </span>
          </div>,
        );
      });
      added.forEach((text, k) => {
        const parts = k < paired ? diffWordsWithSpace(removed[k], text) : null;
        rows.push(
          <div key={`a${newNo}`} className="dl add">
            <span className="ln">{newNo++}</span>
            <span className="txt">
              {parts ? parts.filter((p) => !p.removed).map((p, j) => <span key={j} className={p.added ? 'hl' : ''}>{p.value}</span>) : text}
            </span>
          </div>,
        );
      });
      continue;
    }
    const line = lines[i++];
    if (line.startsWith('+')) {
      rows.push(<div key={`a${newNo}`} className="dl add"><span className="ln">{newNo++}</span><span className="txt">{line.slice(1)}</span></div>);
    } else if (line.startsWith('\\')) {
      rows.push(<div key={`n${i}`} className="dl note"><span className="ln" /><span className="txt">{line}</span></div>);
    } else {
      rows.push(<div key={`c${newNo}`} className="dl"><span className="ln">{newNo}</span><span className="txt">{line.slice(1)}</span></div>);
      oldNo++;
      newNo++;
    }
  }
  return (
    <div className="hunk">
      <div className="hunk-head">Lines {hunk.oldStart}–{hunk.oldStart + Math.max(0, hunk.oldLines - 1)}</div>
      {rows}
    </div>
  );
}

export function ReviewDialog({
  result,
  saving,
  onClose,
  onSave,
}: {
  result: ComposeResponse;
  saving: boolean;
  onClose: () => void;
  onSave: (confirmWarnings: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const { audit } = result;
  const risky = audit.missing.length > 0 || !!audit.parseError || !!audit.frontmatterError;
  return (
    <div className="modal-back" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <h3>Review changes</h3>
        {!result.changed && <p>There are no changes to save. The file stays exactly as it is.</p>}
        {result.diskChanged && (
          <div className="alert danger">The file changed on disk after you opened it. Saving is blocked. Close this, copy your text, and reload the file.</div>
        )}
        {audit.missing.length > 0 && (
          <div className="alert danger">
            <strong>{audit.missing.length} protected item(s) will be removed or changed:</strong>
            <ul>
              {audit.missing.map((m, i) => (
                <li key={i}>
                  <b>{m.label}</b> <code>{m.source.replace(/\s+/g, ' ').slice(0, 140)}</code>
                </li>
              ))}
            </ul>
          </div>
        )}
        {audit.parseError && <div className="alert danger"><strong>The new file is not valid {`MDX/Markdown`}:</strong> {audit.parseError}</div>}
        {audit.frontmatterError && <div className="alert danger"><strong>The frontmatter is not valid YAML:</strong> {audit.frontmatterError}</div>}
        {audit.note && <div className="alert">{audit.note}</div>}
        {result.changed && !risky && <div className="alert ok">All protected MDX, HTML and components are kept unchanged.</div>}
        {result.changedFields.length > 0 && <p className="muted">Changed fields: {result.changedFields.join(', ')}</p>}

        <div className="diff">{result.hunks.map((h, i) => <HunkView key={i} hunk={h} />)}</div>

        <div className="row-end">
          {risky && (
            <label className="confirm">
              <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} /> I understand these warnings. Save anyway.
            </label>
          )}
          <button type="button" onClick={onClose}>Keep editing</button>
          <button
            type="button"
            className="primary"
            disabled={!result.changed || result.diskChanged || saving || (risky && !confirmed)}
            onClick={() => onSave(risky && confirmed)}
          >
            {saving ? 'Saving…' : 'Save to file'}
          </button>
        </div>
      </div>
    </div>
  );
}
