import React, { useState } from 'react';
import { Play, RefreshCw, Terminal, Loader2, Save, XCircle, X } from 'lucide-react';
import { api } from '../lib/api';
import { MODULE_MAP } from '../lib/registry';
import IntegrationBadge from './IntegrationBadge';

interface Props {
  onToast?: (msg: string) => void;
  onDataChanged?: () => void;
}

export default function OltModule({ onToast, onDataChanged }: Props) {
  const mod = MODULE_MAP.olts;
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Array<string | number>>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<Record<string, { loading: boolean; result?: string }>>({});

  const emptyForm = () => {
    const form: Record<string, any> = {};
    mod?.fields.forEach((field) => {
      if (field.type === 'select' && field.options?.length) form[field.name] = field.options[0];
      else if (field.type === 'number' || field.type === 'money' || field.type === 'percent') form[field.name] = 0;
      else form[field.name] = '';
    });
    return { ...(mod?.defaults || {}), ...form };
  };

  const load = async () => {
    if (!mod) return;
    setLoading(true);
    try {
      const res = await api.list(mod.key, search.trim() ? { search: search.trim() } : {});
      setRows(res.rows || []);
    } catch (e: any) {
      onToast?.('Error cargando OLTs: ' + e.message);
    } finally {
      setLoading(false);
      setSelected([]);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setError(null);
    setModalOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    const next: Record<string, any> = { ...emptyForm(), ...row };
    mod.fields.forEach((fld) => {
      if (next[fld.name] === null || next[fld.name] === undefined) next[fld.name] = '';
    });
    setForm(next);
    setError(null);
    setModalOpen(true);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res: any = editing ? await api.update(mod.key, editing.id, form) : await api.create(mod.key, form);
      if (res.status === 'success') {
        setModalOpen(false);
        onToast?.(res.message);
        await load();
        onDataChanged?.();
      } else {
        setError(res.message || 'No se pudo guardar el registro.');
      }
    } catch (e: any) {
      setError(e.message || 'Error guardando');
    }
  };

  const remove = async (row: any) => {
    if (!window.confirm(`¿Eliminar la OLT ${row.code || row.id}?`)) return;
    try {
      const res: any = await api.remove(mod.key, row.id);
      onToast?.(res.message || 'Registro eliminado.');
      await load();
      onDataChanged?.();
    } catch (e: any) {
      onToast?.('Error eliminando: ' + e.message);
    }
  };

  const handleTest = async (row: any) => {
    setActionStates(prev => ({ ...prev, [row.id]: { loading: true } }));
    try {
      const res = await api.oltTest(row.id);
      setActionStates(prev => ({
        ...prev,
        [row.id]: { loading: false, result: res.message || (res.ok ? 'Test OK' : 'Test falló') }
      }));
      onToast?.(res.message || (res.ok ? 'Conexión SNMP exitosa' : 'Error en test SNMP'));
      if (res.ok) await load();
    } catch (e: any) {
      setActionStates(prev => ({ ...prev, [row.id]: { loading: false, result: e.message } }));
      onToast?.('Error en test: ' + e.message);
    }
  };

  const handleSync = async (row: any) => {
    setActionStates(prev => ({ ...prev, [row.id]: { loading: true } }));
    try {
      const res = await api.oltSync(row.id);
      setActionStates(prev => ({
        ...prev,
        [row.id]: { loading: false, result: res.message || 'Sincronización completada' }
      }));
      onToast?.(res.message || 'OLT sincronizada');
      await load();
    } catch (e: any) {
      setActionStates(prev => ({ ...prev, [row.id]: { loading: false, result: e.message } }));
      onToast?.('Error sincronizando: ' + e.message);
    }
  };

  const handleCommand = async (row: any) => {
    const command = prompt('Ingrese el comando Telnet a ejecutar:');
    if (!command) return;

    setActionStates(prev => ({ ...prev, [row.id]: { loading: true } }));
    try {
      const res = await api.oltCommand(row.id, command);
      setActionStates(prev => ({
        ...prev,
        [row.id]: { loading: false, result: res.output?.slice(0, 200) + '...' || 'Comando ejecutado' }
      }));
      onToast?.('Comando ejecutado');
    } catch (e: any) {
      setActionStates(prev => ({ ...prev, [row.id]: { loading: false, result: e.message } }));
      onToast?.('Error en comando: ' + e.message);
    }
  };

  const badge = (value: unknown, tone?: string) => {
    const toneClass: Record<string, string> = {
      ok: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
      warn: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
      bad: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
      info: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
      muted: 'bg-slate-500/15 text-slate-300 border-slate-600/50',
    };
    const cls = toneClass[tone || 'muted'] || toneClass.muted;
    return (
      <span className={`inline-flex whitespace-nowrap rounded-md border px-2 py-0.5 text-[11px] font-medium ${cls}`}>
        {String(value ?? '—')}
      </span>
    );
  };

  const cell = (row: any, col: any) => {
    const value = row[col.name];
    if (col.type === 'badge') return badge(value, col.tone);
    if (col.type === 'money') return <span className="font-mono tabular-nums">${Number(value || 0).toFixed(2)}</span>;
    if (col.type === 'number') return <span className="font-mono tabular-nums">{Number(value || 0).toLocaleString('es')}</span>;
    if (col.type === 'percent') return <span className="font-mono tabular-nums">{Number(value || 0)}%</span>;
    if (col.type === 'mono') return <span className="font-mono tabular-nums text-slate-300">{String(value ?? '—')}</span>;
    return <span className="text-slate-200">{String(value ?? '').trim() || '—'}</span>;
  };

  const renderField = (fld: any) => {
    const value = form[fld.name] ?? '';
    const common = 'w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none';
    const set = (v: any) => setForm(prev => ({ ...prev, [fld.name]: v }));

    if (fld.type === 'textarea')
      return (
        <textarea rows={3} value={value} onChange={e => set(e.target.value)} placeholder={fld.placeholder} className={common} />
      );

    if (fld.type === 'select')
      return (
        <select value={value} onChange={e => set(e.target.value)} className={common}>
          {(fld.options || []).map((opt: string) => <option key={opt} value={opt}>{opt}</option>)}
        </select>
      );

    const inputType = fld.type === 'password' ? 'password' : 
      fld.type === 'number' || fld.type === 'money' || fld.type === 'percent' ? 'number' :
      fld.type === 'date' ? 'date' :
      fld.type === 'time' ? 'time' :
      fld.type === 'datetime' ? 'datetime-local' :
      fld.type === 'email' ? 'email' :
      fld.type === 'tel' ? 'tel' : 'text';

    return (
      <input
        type={inputType}
        step={fld.type === 'money' || fld.type === 'percent' ? '0.01' : undefined}
        value={value}
        required={fld.required}
        onChange={e => set(e.target.value)}
        placeholder={fld.placeholder}
        className={common}
      />
    );
  };

  if (!mod) return <div className="rounded-lg border border-rose-500/40 bg-rose-950/30 p-6 text-sm text-rose-200">Módulo OLT no encontrado</div>;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">{mod.label}</h1>
          <p className="mt-1 text-xs text-slate-400">{mod.description}</p>
          {mod.integration && <IntegrationBadge kind={mod.integration} />}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} disabled={loading} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400">
            <span className="h-3.5 w-3.5">+</span>
            Nueva OLT
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && load()}
          placeholder="Buscar OLT por código, nombre, marca, IP, driver..."
          className="w-full sm:w-80 rounded-lg border border-slate-800 bg-slate-900 py-2 pl-9 pr-3 text-xs text-slate-100 placeholder-slate-500"
        />
        <span className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500">🔍</span>
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/70">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400">
                <th className="w-8 px-3 py-3"><input type="checkbox" className="accent-sky-500" /></th>
                {mod.columns.map((col: any) => (
                  <th key={col.name} className="whitespace-nowrap px-3 py-3">{col.label}</th>
                ))}
                <th className="px-4 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70 text-xs">
              {rows.map((row: any) => {
                const state = actionStates[row.id];
                return (
                  <tr key={row.id} className="hover:bg-slate-800/40">
                    <td className="px-3 py-2.5">
                      <input type="checkbox" checked={selected.includes(row.id)} onChange={() => setSelected(prev => prev.includes(row.id) ? prev.filter(x => x !== row.id) : [...prev, row.id])} className="accent-sky-500" />
                    </td>
                    {mod.columns.map((col: any) => (
                      <td key={col.name} className="px-3 py-2.5">{cell(row, col)}</td>
                    ))}
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          onClick={() => handleTest(row)}
                          disabled={state?.loading}
                          title="Probar conectividad SNMP"
                          className="inline-flex items-center gap-1 rounded-md border border-sky-500/40 bg-sky-500/10 px-2.5 py-1.5 text-xs font-medium text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 whitespace-nowrap"
                        >
                          {state?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                          <span>Probar</span>
                        </button>
                        <button
                          onClick={() => handleSync(row)}
                          disabled={state?.loading}
                          title="Sincronizar datos SNMP"
                          className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1.5 text-xs font-medium text-emerald-300 hover:bg-emerald-500/20 disabled:opacity-50 whitespace-nowrap"
                        >
                          {state?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          <span>Sync</span>
                        </button>
                        <button
                          onClick={() => handleCommand(row)}
                          disabled={state?.loading}
                          title="Ejecutar comando Telnet"
                          className="inline-flex items-center gap-1 rounded-md border border-purple-500/40 bg-purple-500/10 px-2.5 py-1.5 text-xs font-medium text-purple-300 hover:bg-purple-500/20 disabled:opacity-50 whitespace-nowrap"
                        >
                          {state?.loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Terminal className="h-3 w-3" />}
                          <span>Cmd</span>
                        </button>
                        <button onClick={() => openEdit(row)} title="Editar" className="rounded-md border border-slate-700 bg-slate-950 p-1.5 text-slate-300 hover:bg-slate-800">
                          <span className="h-3.5 w-3.5">✏️</span>
                        </button>
                        <button onClick={() => remove(row)} title="Eliminar" className="rounded-md border border-rose-500/40 bg-rose-950/40 p-1.5 text-rose-300 hover:bg-rose-900/50">
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {state?.result && (
                        <div className="mt-1.5 text-[10px] font-mono text-slate-400 bg-slate-950 rounded p-1.5 max-w-xs truncate" title={state.result}>
                          {state.result}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr>
                  <td colSpan={mod.columns.length + 2} className="px-4 py-12 text-center text-xs text-slate-500">
                    Sin OLTs registradas. Usa «Nueva OLT» para dar de alta la primera cabecera FTTH.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm">
          <div className="my-8 w-full max-w-3xl overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <div>
                <h2 className="text-base font-semibold text-slate-100">{editing ? `Editar ${mod.label}` : `Nueva OLT FTTH`}</h2>
                <p className="text-[11px] text-slate-400">{mod.description}</p>
              </div>
              <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <form onSubmit={submit} className="space-y-4 p-6 text-xs">
              {error && <div className="rounded-lg border border-rose-500/40 bg-rose-950/40 px-3.5 py-2.5 text-rose-200">{error}</div>}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mod.fields.map((fld: any) => (
                  <div key={fld.name} className={fld.type === 'textarea' ? 'sm:col-span-2 lg:col-span-3' : ''}>
                    <label className="mb-1 block text-slate-300">{fld.label} {fld.required && <span className="ml-1 text-rose-400">*</span>}</label>
                    {renderField(fld)}
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2 border-t border-slate-800 pt-4">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-300">Cancelar</button>
                <button type="submit" className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400">
                  <Save className="h-3.5 w-3.5" />
                  {editing ? 'Guardar cambios' : 'Crear OLT'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}