import React, { useEffect, useState } from 'react';

const blank = { name: '', cwd: '', command: '', autostart: false };

function envToRows(env) {
  const rows = Object.entries(env || {}).map(([key, value]) => ({ key, value }));
  return rows.length ? rows : [{ key: '', value: '' }];
}

export default function AppForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(blank);
  const [rows, setRows] = useState(envToRows());
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({ ...blank, ...(initial || {}) });
    setRows(envToRows(initial?.env));
    setError('');
  }, [initial]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const browse = async () => {
    const dir = await window.kai.pickDirectory(form.cwd || undefined);
    if (dir) set({ cwd: dir });
  };

  const setRow = (i, patch) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const submit = (e) => {
    e.preventDefault();
    if (!form.name.trim()) return setError('Give it a name.');
    if (!form.cwd.trim()) return setError('Pick a project folder.');
    if (!form.command.trim()) return setError('Enter a command, for example: npm run dev');
    onSave({ ...form, env: rows.filter((r) => r.key.trim()) });
  };

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <form className="modal" onSubmit={submit}>
        <h2>{initial?.id ? 'Edit app' : 'Add app'}</h2>

        <label>
          <span>Name</span>
          <input
            autoFocus
            value={form.name}
            placeholder="Storefront"
            onChange={(e) => set({ name: e.target.value })}
          />
        </label>

        <label>
          <span>Project folder</span>
          <div className="row">
            <input
              value={form.cwd}
              placeholder="/Users/you/projects/storefront"
              onChange={(e) => set({ cwd: e.target.value })}
            />
            <button type="button" className="btn" onClick={browse}>Browse</button>
          </div>
        </label>

        <label>
          <span>Command</span>
          <input
            value={form.command}
            placeholder="npm run dev"
            spellCheck={false}
            onChange={(e) => set({ command: e.target.value })}
          />
        </label>

        <div className="env-block">
          <span className="label">Environment variables <em>applied on top of the inherited env</em></span>
          {rows.map((row, i) => (
            <div className="row env-row" key={i}>
              <input
                value={row.key}
                placeholder="PORT"
                spellCheck={false}
                onChange={(e) => setRow(i, { key: e.target.value })}
              />
              <input
                value={row.value}
                placeholder="3000"
                spellCheck={false}
                onChange={(e) => setRow(i, { value: e.target.value })}
              />
              <button
                type="button"
                className="btn ghost"
                title="Remove"
                onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : [{ key: '', value: '' }]))}
              >
                Remove
              </button>
            </div>
          ))}
          <button type="button" className="btn ghost" onClick={() => setRows((rs) => [...rs, { key: '', value: '' }])}>
            Add variable
          </button>
        </div>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={!!form.autostart}
            onChange={(e) => set({ autostart: e.target.checked })}
          />
          <span>Start automatically when Kai opens</span>
        </label>

        {error && <p className="form-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
          <button type="submit" className="btn primary">Save</button>
        </div>
      </form>
    </div>
  );
}
