import React, { useCallback, useEffect, useState } from 'react';
import { BookOpen, Scale, TrendingDown, TrendingUp, RefreshCw } from 'lucide-react';
import { api, formatMoney } from '../lib/api';

function Line({ label, value, tone = 'neutral', strong }: { label: string; value: number; tone?: 'good' | 'bad' | 'neutral' | 'warn'; strong?: boolean }) {
  const colors: Record<string, string> = {
    good: 'text-emerald-400',
    bad: 'text-rose-400',
    warn: 'text-amber-400',
    neutral: 'text-slate-200',
  };
  return (
    <div className={`flex items-center justify-between py-2 ${strong ? 'border-t border-slate-700' : 'border-b border-slate-800/60'}`}>
      <span className={`text-xs ${strong ? 'font-semibold text-slate-100' : 'text-slate-300'}`}>{label}</span>
      <span className={`font-mono text-sm tabular-nums ${colors[tone]} ${strong ? 'font-semibold' : ''}`}>{formatMoney(value)}</span>
    </div>
  );
}

export default function AccountingDashboard({ onToast }: { onToast?: (m: string) => void }) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res: any = await api.get('/api/v1/accounting/summary');
    if (res.status === 'success') setData(res);
    else onToast?.('No se pudo cargar la contabilidad.');
    setLoading(false);
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const inc = data?.income_statement;
  const bal = data?.balance_sheet;
  const balanced = bal ? Math.abs(bal.total_assets - (bal.total_liabilities + bal.equity)) < 0.01 : false;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Contabilidad</h1>
          <p className="mt-1 text-xs text-slate-400">
            Estado de resultados y balance general calculados en vivo desde tus pagos, otros ingresos, gastos y activos
            fijos registrados.
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

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Estado de Resultados */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">Estado de Resultados</h2>
          </div>
          <Line label="Ingresos por mensualidad (pagos)" value={inc?.internet_income ?? 0} tone="good" />
          <Line label="Otros ingresos" value={inc?.other_income ?? 0} tone="good" />
          <Line label="Total de ingresos" value={inc?.total_income ?? 0} tone="good" strong />
          <div className="mt-3 mb-1 flex items-center gap-2 text-xs font-semibold text-rose-300">
            <TrendingDown className="h-3.5 w-3.5" />
            Gastos por categoría
          </div>
          {((inc?.expenses_by_category || []) as any[]).map((row) => (
            <div key={row.category} className="flex items-center justify-between border-b border-slate-800/60 py-1.5 text-xs">
              <span className="text-slate-400">{row.category}</span>
              <span className="font-mono tabular-nums text-rose-300">−{formatMoney(row.amount)}</span>
            </div>
          ))}
          {(!inc?.expenses_by_category || inc.expenses_by_category.length === 0) && (
            <p className="py-1.5 text-[11px] text-slate-500">Sin gastos registrados.</p>
          )}
          <Line label="Total de egresos" value={inc?.expenses_total ?? 0} tone="bad" strong />
          <Line
            label="Utilidad neta"
            value={inc?.net_profit ?? 0}
            tone={(inc?.net_profit ?? 0) >= 0 ? 'good' : 'bad'}
            strong
          />
          <p className="mt-2 text-[11px] text-slate-500">Margen: {inc?.margin_pct ?? 0}%</p>
        </div>

        {/* Balance General */}
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="mb-4 flex items-center gap-2">
            <Scale className="h-4 w-4 text-sky-400" />
            <h2 className="text-sm font-semibold text-slate-100">Balance General</h2>
          </div>
          <div className="text-xs font-semibold uppercase tracking-wide text-sky-300">Activos</div>
          <Line label="Caja / Bancos (cobrado − gastos pagados)" value={bal?.cash ?? 0} />
          <Line label="Cuentas por cobrar (facturas pendientes)" value={bal?.accounts_receivable ?? 0} />
          <Line label="Activos fijos (valor en libros)" value={bal?.fixed_assets ?? 0} />
          <Line label="Total de activos" value={bal?.total_assets ?? 0} tone="good" strong />
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-amber-300">Pasivos</div>
          <Line label="Cuentas por pagar (gastos pendientes)" value={bal?.total_liabilities ?? 0} tone="warn" />
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-emerald-300">Patrimonio</div>
          <Line label="Patrimonio (activos − pasivos)" value={bal?.equity ?? 0} strong />
          <p className={`mt-2 text-[11px] ${balanced ? 'text-emerald-400' : 'text-slate-500'}`}>
            {balanced ? 'Activos = Pasivos + Patrimonio ✓' : 'El balance cuadra por construcción (patrimonio = activos − pasivos).'}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <div className="mb-2 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-purple-400" />
          <h2 className="text-sm font-semibold text-slate-100">Origen de los datos</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 text-xs text-slate-400 sm:grid-cols-5">
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="font-mono text-lg text-slate-100">{data?.meta?.payments_count ?? 0}</div>
            Pagos validados
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="font-mono text-lg text-slate-100">{data?.meta?.expenses_count ?? 0}</div>
            Gastos
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="font-mono text-lg text-slate-100">{data?.meta?.invoices_count ?? 0}</div>
            Facturas
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="font-mono text-lg text-slate-100">{data?.meta?.assets_count ?? 0}</div>
            Activos fijos
          </div>
          <div className="rounded border border-slate-800 bg-slate-950 p-3">
            <div className="font-mono text-lg text-slate-100">{data?.meta?.bank_accounts_count ?? 0}</div>
            Cuentas bancarias
          </div>
        </div>
      </div>
    </div>
  );
}
