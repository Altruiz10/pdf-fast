import { useEffect, useState } from 'react';
import { useDoc } from '../store';
import { fillFields, readFields, type FieldInfo } from '../lib/pdfops';

export function FormsPanel() {
  const { doc, commit, run, toast } = useDoc();
  const [fields, setFields] = useState<FieldInfo[] | null>(null);
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [flatten, setFlatten] = useState(false);

  useEffect(() => {
    if (!doc) return;
    setFields(null);
    readFields(doc.bytes)
      .then((f) => {
        setFields(f);
        setValues(Object.fromEntries(f.filter((x) => 'value' in x).map((x) => [x.name, (x as { value: string | boolean }).value])));
      })
      .catch(() => setFields([]));
  }, [doc?.bytes]);

  if (!fields) return <p className="muted pad">Lendo campos…</p>;
  if (!fields.length) return <p className="muted pad">Este PDF não tem campos de formulário.</p>;

  const set = (name: string, v: string | boolean) => setValues((o) => ({ ...o, [name]: v }));

  const apply = () =>
    run('Preenchendo formulário…', async () => {
      await commit(await fillFields(doc!.bytes, values, flatten), flatten ? 'Preencher e fixar formulário' : 'Preencher formulário', {
        keepAnnots: true,
      });
      toast('Formulário atualizado.', 'success');
    });

  return (
    <div className="forms">
      {fields.map((f) => (
        <div key={f.name} className="form-field">
          <span className="form-name">{f.name}</span>
          {f.kind === 'text' &&
            (f.multiline ? (
              <textarea disabled={f.readOnly} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} rows={3} />
            ) : (
              <input disabled={f.readOnly} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)} />
            ))}
          {f.kind === 'checkbox' && (
            <label className="check">
              <input type="checkbox" disabled={f.readOnly} checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
              Marcado
            </label>
          )}
          {(f.kind === 'radio' || f.kind === 'dropdown' || f.kind === 'list') && (
            <select disabled={f.readOnly} value={String(values[f.name] ?? '')} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">—</option>
              {f.options.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          )}
          {f.kind === 'other' && <span className="muted">{f.label}</span>}
        </div>
      ))}
      <label className="check">
        <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} />
        Fixar campos (não editáveis depois)
      </label>
      <button className="btn primary block" onClick={apply}>
        Aplicar no PDF
      </button>
    </div>
  );
}
