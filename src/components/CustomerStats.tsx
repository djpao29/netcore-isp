import React, { useCallback, useEffect, useState } from 'react';
import { BarChart3, MapPin, RefreshCw, Users } from 'lucide-react';
import { api } from '../lib/api';
import { statusTone } from '../lib/registry';

export default function CustomerStats({ onToast }: { onToast?: (m: string) => void }) {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.customerStats();
    if (res.status === 'success') setStats(res);
    else onToast?.('No se pudieron cargar las estadísticas de clientes.');
    setLoading(false);
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const toneCls: Record<string, string> = {
    ok: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-rose-400',
    info: 'text-sky-400',
    muted: 'text-slate-400',
  };

  const maxSector = Math.max(1, ...((stats?.by_sector || []).map((x: any) => x.count) as number[]));
  const maxMonth = Math.max(1, ...((stats?.by_month || []).map((x: any) => x.count) as number[]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Estadísticas de Clientes</h1>
          <p className="mt-1 text-xs text-slate-400">
            Clientes por estado, zona, sector y mes de alta — base para las tablas de Clientes, Facturas y Tickets.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-1.5 self-start rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refrescar
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs text-slate-400">Total Clientes</span>
            <Users className="h-4 w-4 text-sky-400" />
          </div>
          <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-slate-100">{stats?.total ?? 0}</div>
        </div>
        {((stats?.by_status || []) as any[]).slice(0, 4).map((row) => (
          <div key={row.status} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
            <div className="text-xs text-slate-400">{row.status}</div>
            <div className={`mt-1.5 font-mono text-2xl font-semibold tabular-nums ${toneCls[statusTone(row.status)]}`}>
              {row.count}
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Clientes por Sector</h2>
          </div>
          <div className="mt-4 space-y-3">
            {((stats?.by_sector || []) as any[]).map((row) => (
              <div key={row.sector}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-300">{row.sector}</span>
                  <span className="font-mono tabular-nums text-slate-400">{row.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div className="h-full rounded-full bg-sky-500/80" style={{ width: `${Math.round((row.count / maxSector) * 100)}%` }} />
                </div>
              </div>
            ))}
            {(!stats?.by_sector || stats.by_sector.length === 0) && <p className="text-xs text-slate-500">Sin clientes registrados.</p>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">Altas por Mes</h2>
          </div>
          <div className="mt-4 flex h-40 items-end gap-3 border-b border-slate-800 pb-3">
            {((stats?.by_month || []) as any[]).slice(-8).map((row) => (
              <div key={row.month} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5">
                <span className="font-mono text-[10px] text-slate-400">{row.count}</span>
                <div
                  className="w-full max-w-[36px] rounded-t-md bg-emerald-500/80"
                  style={{ height: `${Math.max(Math.round((row.count / maxMonth) * 100), row.count > 0 ? 4 : 0)}%` }}
                />
                <span className="text-[10px] capitalize text-slate-400">{String(row.month).slice(2)}</span>
              </div>
            ))}
            {(!stats?.by_month || stats.by_month.length === 0) && <p className="text-xs text-slate-500">Sin datos de alta.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
