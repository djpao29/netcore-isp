import React, { useCallback, useEffect, useState } from 'react';
import { MonitorPlay, RefreshCw, Eye } from 'lucide-react';
import { api, formatMoney } from '../lib/api';

export default function ScreenNoticePreview({ onToast }: { onToast?: (m: string) => void }) {
  const [notices, setNotices] = useState<any[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [company, setCompany] = useState('Mi ISP');
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [res, boot] = await Promise.all([api.list('screen_notices'), api.bootstrap()]);
    if (res.status === 'success') {
      setNotices(res.rows);
      if (res.rows.length && selectedId === null) setSelectedId(res.rows[0].id);
    } else {
      onToast?.('No se pudieron cargar los avisos.');
    }
    if (boot?.isps?.[0]?.name) setCompany(boot.isps[0].name);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onToast]);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = notices.find((n) => n.id === selectedId) || notices[0] || null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Avisos en Pantalla · Vista Previa</h1>
          <p className="mt-1 text-xs text-slate-400">
            Así verá el cliente el aviso de pago/corte/mantenimiento redirigido al navegar. Simula el comportamiento real
            del aviso en el portal del cliente.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {notices.length > 0 && (
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
            >
              {notices.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.name} ({n.type})
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            onClick={load}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
            Refrescar
          </button>
        </div>
      </div>

      {!selected ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 py-20 text-center">
          <MonitorPlay className="h-8 w-8 text-slate-600" />
          <h2 className="text-base font-semibold text-slate-200">Sin avisos configurados</h2>
          <p className="max-w-md text-xs text-slate-400">
            Crea avisos en «Ajustes → Avisos en Pantalla» para replicarlos aquí hacia tus clientes.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-2 text-xs">
            <h2 className="text-sm font-semibold text-slate-100">{selected.name}</h2>
            <div className="text-slate-400">Tipo: <span className="text-slate-200">{selected.type}</span></div>
            <div className="text-slate-400">Duración: <span className="text-slate-200">{selected.duration_seconds}s</span></div>
            <div className="text-slate-400">Mostrar total: <span className="text-slate-200">{selected.show_total}</span></div>
            <div className="text-slate-400">Vigencia: <span className="text-slate-200">{selected.active_from || '—'} → {selected.active_to || '—'}</span></div>
            <div className="text-slate-400">Estado: <span className="text-slate-200">{selected.status}</span></div>
            <button
              type="button"
              onClick={() => setPreview(true)}
              className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              <Eye className="h-3.5 w-3.5" />
              Simular aviso al cliente
            </button>
          </div>

          <div className="lg:col-span-2 rounded-lg border border-slate-800 bg-slate-900/60 p-5">
            <div className="mb-3 text-xs font-semibold text-slate-300">Vista del navegador del cliente</div>
            <div className="overflow-hidden rounded-lg border border-slate-800">
              <div className="flex items-center gap-2 border-b border-slate-800 bg-slate-950 px-3 py-2">
                <span className="h-2.5 w-2.5 rounded-full bg-rose-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/70" />
                <span className="ml-2 font-mono text-[11px] text-slate-500">https://www.google.com/ — conexión de {company}</span>
              </div>
              <div className="flex min-h-[280px] items-center justify-center bg-slate-800/60 p-6">
                <div className={`w-full max-w-md rounded-xl border p-5 text-center ${toneFor(selected.type).panel}`}>
                  <div className={`text-base font-bold ${toneFor(selected.type).title}`}>{selected.title || 'Aviso'}</div>
                  <p className="mt-2 whitespace-pre-line text-xs text-slate-200">
                    {selected.message || 'Su servicio presenta una novedad. Comuníquese con soporte.'}
                  </p>
                  {selected.show_total === 'Sí' && (
                    <div className="mt-4 rounded-lg border border-slate-700 bg-slate-950 px-4 py-2">
                      <div className="text-[11px] text-slate-400">Total a pagar</div>
                      <div className="font-mono text-lg font-semibold text-amber-300">
                        {formatMoney(selected.total_due ?? 0)}
                      </div>
                    </div>
                  )}
                  <div className="mt-4 flex items-center justify-center gap-2">
                    <button type="button" className="rounded-lg bg-sky-500 px-3.5 py-2 text-xs font-semibold text-slate-950">
                      Ir al portal de pagos
                    </button>
                    <button type="button" className="rounded-lg border border-slate-600 px-3.5 py-2 text-xs text-slate-200">
                      Contactar soporte
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Overlay simulado */}
      {preview && selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-sm" onClick={() => setPreview(false)}>
          <div className={`w-full max-w-lg rounded-xl border p-6 text-center ${toneFor(selected.type).panel}`} onClick={(e) => e.stopPropagation()}>
            <div className={`text-lg font-bold ${toneFor(selected.type).title}`}>{selected.title || 'Aviso'}</div>
            <p className="mt-3 whitespace-pre-line text-sm text-slate-200">
              {selected.message || 'Su servicio presenta una novedad. Comuníquese con soporte.'}
            </p>
            <p className="mt-4 text-[11px] text-slate-400">Este aviso se cierra automáticamente en {selected.duration_seconds} segundos.</p>
            <button
              type="button"
              onClick={() => setPreview(false)}
              className="mt-4 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
            >
              Cerrar simulación
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function toneFor(type: string): { panel: string; title: string } {
  const t = String(type || '').toLowerCase();
  if (t.includes('corte'))
    return { panel: 'border-rose-500/50 bg-rose-950/60', title: 'text-rose-200' };
  if (t.includes('mantenimiento'))
    return { panel: 'border-amber-500/50 bg-amber-950/40', title: 'text-amber-200' };
  if (t.includes('pago'))
    return { panel: 'border-sky-500/50 bg-sky-950/50', title: 'text-sky-200' };
  return { panel: 'border-slate-700 bg-slate-900', title: 'text-slate-100' };
}
