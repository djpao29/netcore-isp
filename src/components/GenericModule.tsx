import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Pencil, Plus, RefreshCw, Save, Search, Trash2, X } from 'lucide-react';
import { api, downloadText, formatMoney, toCsv } from '../lib/api';
import { MODULE_MAP, statusTone, type FieldDef, type ModuleDef } from '../lib/registry';
import IntegrationBadge from './IntegrationBadge';

interface Props {
  moduleKey: string;
  onToast?: (msg: string) => void;
  onDataChanged?: () => void;
  renderRowActions?: (row: any, refresh: () => void) => React.ReactNode;
}

const TONE_CLASS: Record<string, string> = {
  ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  warn: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  bad: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
  info: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  muted: 'bg-slate-500/15 text-slate-300 border-slate-600/50',
};

function emptyForm(mod: ModuleDef): Record<string, any> {
  const form: Record<string, any> = {};
  mod.fields.forEach((field) => {
    if (field.type === 'select' && field.options?.length) form[field.name] = field.options[0];
    else if (field.type === 'number' || field.type === 'money' || field.type === 'percent') form[field.name] = 0;
    else form[field.name] = '';
  });
  return { ...(mod.defaults || {}), ...form };
}

export default function GenericModule({ moduleKey, onToast, onDataChanged, renderRowActions }: Props) {
  const mod: ModuleDef | undefined = MODULE_MAP[moduleKey];
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);

  const filterFields = useMemo(() => (mod ? mod.fields.filter((f) => f.type === 'select' && f.options?.length).slice(0, 3) : []), [mod]);

  const load = useCallback(async () => {
    if (!mod) return;
    setLoading(true);
    const params: Record<string, string> = {};
    if (search.trim()) params.search = search.trim();
    Object.entries(filters).forEach(([k, v]) => {
      if (v) params[k] = v;
    });
    const res = await api.list(mod.key, params);
    setRows(res.rows || []);
    setLoading(false);
    setSelected([]);
  }, [mod, search, filters]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [moduleKey, filters]);

  useEffect(() => {
    if (!mod) return;
    setSearch('');
    setFilters({});
    setSelected([]);
    setError(null);
  }, [moduleKey, mod]);

  if (!mod) {
    return (
      <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-6 text-sm text-rose-200">
        Módulo desconocido: <code>{moduleKey}</code>
      </div>
    );
  }

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(mod));
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    const next: Record<string, any> = { ...emptyForm(mod), ...row };
    mod.fields.forEach((fld) => {
      if (next[fld.name] === null || next[fld.name] === undefined) next[fld.name] = '';
    });
    setForm(next);
    setError(null);
    setModalOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const res: any = editing ? await api.update(mod.key, editing.id, form) : await api.create(mod.key, form);
    if (res.status === 'success') {
      setModalOpen(false);
      onToast?.(res.message);
      await load();
      onDataChanged?.();
    } else {
      setError(res.message || 'No se pudo guardar el registro.');
    }
  };

  const remove = async (row: any) => {
    if (!window.confirm(`¿Eliminar el registro ${row.code || row.id} de ${mod.label}?`)) return;
    const res: any = await api.remove(mod.key, row.id);
    onToast?.(res.message || 'Registro eliminado.');
    await load();
    onDataChanged?.();
  };

  const bulkDelete = async () => {
    if (!selected.length) return;
    if (!window.confirm(`¿Eliminar ${selected.length} registro(s) de ${mod.label}?`)) return;
    const res: any = await api.bulk(mod.key, 'delete', selected);
    onToast?.(res.message);
    await load();
    onDataChanged?.();
  };

  const exportCsv = () => {
    const csv = toCsv(rows, mod.columns);
    downloadText(`${mod.key}.csv`, csv);
    onToast?.(`Exportados ${rows.length} registros de ${mod.label} a CSV.`);
  };

  const allSelected = rows.length > 0 && selected.length === rows.length;
  const toggleAll = () => setSelected(allSelected ? [] : rows.map((r) => r.id));
  const toggleOne = (id: number | string) =>
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const badge = (value: unknown, tone?: string) => {
    const cls = TONE_CLASS[tone || statusTone(value)] || TONE_CLASS.muted;
    return (
      <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
        {String(value ?? '—')}
      </span>
    );
  };

  const cell = (row: any, col: ModuleDef['columns'][number]) => {
    const value = row[col.name];
    if (col.type === 'badge') return badge(value, col.tone);
    if (col.type === 'money') return <span className="font-mono tabular-nums">{formatMoney(value)}</span>;
    if (col.type === 'number')
      return <span className="font-mono tabular-nums">{Number(value || 0).toLocaleString('es')}</span>;
    if (col.type === 'percent') return <span className="font-mono tabular-nums">{Number(value || 0)}%</span>;
    if (col.type === 'mono') return <span className="font-mono tabular-nums text-slate-300">{String(value ?? '—')}</span>;
    return <span className="text-slate-200">{String(value ?? '').trim() || '—'}</span>;
  };

  const renderField = (fld: FieldDef) => {
    const value = form[fld.name] ?? '';
    const common =
      'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none';
    const set = (v: any) => setForm((prev) => ({ ...prev, [fld.name]: v }));

    if (fld.type === 'textarea')
      return (
        <textarea
          rows={3}
          value={value}
          onChange={(e) => set(e.target.value)}
          placeholder={fld.placeholder}
          className={common}
        />
      );

    if (fld.type === 'select')
      return (
        <select value={value} onChange={(e) => set(e.target.value)} className={common}>
          {(fld.options || []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      );

    const inputType =
      fld.type === 'number' || fld.type === 'money' || fld.type === 'percent'
        ? 'number'
        : fld.type === 'date'
          ? 'date'
          : fld.type === 'time'
            ? 'time'
            : fld.type === 'datetime'
              ? 'datetime-local'
              : fld.type === 'password'
                ? 'password'
                : fld.type === 'email'
                  ? 'email'
                  : fld.type === 'tel'
                    ? 'tel'
                    : 'text';

    return (
      <input
        type={inputType}
        step={fld.type === 'money' || fld.type === 'percent' ? '0.01' : undefined}
        value={value}
        required={fld.required}
        onChange={(e) => set(e.target.value)}
        placeholder={fld.placeholder}
        className={common}
      />
    );
  };

  return (
    <div className="space-y-5">
      {/* Encabezado */}
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{mod.label}</h1>
          <p className="mt-1 text-xs text-slate-400">{mod.description}</p>
          {mod.integration && (
            <div className="mt-2">
              <IntegrationBadge kind={mod.integration} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
          >
            <Plus className="h-3.5 w-3.5" />
            Nuevo
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder={`Buscar en ${mod.label.toLowerCase()}...`}
            className="w-full rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500 sm:w-72"
          />
        </div>
        {filterFields.map((fld) => (
          <select
            key={fld.name}
            value={filters[fld.name] || ''}
            onChange={(e) => setFilters((prev) => ({ ...prev, [fld.name]: e.target.value }))}
            className="rounded-lg border border-slate-800 bg-slate-900 px-3 py-2 text-xs text-slate-200"
          >
            <option value="">{fld.label}: todos</option>
            {(fld.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        ))}
        {selected.length > 0 && (
          <div className="flex items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-950/40 px-3 py-1.5 text-xs text-sky-200">
            <span className="font-mono">{selected.length} seleccionado(s)</span>
            <button type="button" onClick={bulkDelete} className="text-rose-300 hover:underline">
              Eliminar seleccionados
            </button>
          </div>
        )}
        <span className="ml-auto font-mono text-[11px] text-slate-500">
          {rows.length} registro(s){search || Object.values(filters).some(Boolean) ? ' filtrados' : ''}
        </span>
      </div>

      {/* Tabla */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400">
                <th className="w-8 px-3 py-3">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-sky-500" />
                </th>
                {mod.columns.map((col) => (
                  <th key={col.name} className="whitespace-nowrap px-3 py-3">
                    {col.label}
                  </th>
                ))}
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-slate-800/40">
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      checked={selected.includes(row.id)}
                      onChange={() => toggleOne(row.id)}
                      className="accent-sky-500"
                    />
                  </td>
                  {mod.columns.map((col) => (
                    <td key={col.name} className="px-3 py-2.5">
                      {cell(row, col)}
                    </td>
                  ))}
                  <td className="px-4 py-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      {renderRowActions?.(row, load)}
                      <button
                        type="button"
                        onClick={() => openEdit(row)}
                        title="Editar"
                        className="rounded-md border border-slate-700 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(row)}
                        title="Eliminar"
                        className="rounded-md border border-rose-500/40 bg-rose-950/40 p-1.5 text-rose-300 hover:bg-rose-900/50"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={mod.columns.length + 2} className="px-4 py-12 text-center text-xs text-slate-500">
                    Sin registros todavía. Usa «Nuevo» para dar de alta el primer registro de {mod.label}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de alta/edición */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-2xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">
                  {editing ? `Editar ${mod.label}` : `Nuevo registro · ${mod.label}`}
                </h2>
                <p className="text-[11px] text-slate-400">{mod.description}</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={submit} className="space-y-4 p-6 text-xs">
              {error && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-rose-200">{error}</div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mod.fields.map((fld) => (
                  <div key={fld.name} className={fld.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <label className="mb-1 block text-slate-300">
                      {fld.label}
                      {fld.required && <span className="ml-1 text-rose-400">*</span>}
                    </label>
                    {renderField(fld)}
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Save className="h-3.5 w-3.5" />
                  {editing ? 'Guardar cambios' : 'Crear registro'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
