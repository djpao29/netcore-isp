import React, { useCallback, useEffect, useState } from 'react';
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  FileWarning,
  HandCoins,
  PiggyBank,
  RefreshCw,
  Receipt,
  Scale,
  Wallet,
} from 'lucide-react';
import { api, formatMoney } from '../lib/api';

const KPI = ({
  label,
  value,
  hint,
  tone = 'neutral',
  icon: Icon,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'good' | 'bad' | 'warn' | 'neutral';
  icon: React.ElementType;
}) => {
  const colors: Record<string, string> = {
    good: 'text-emerald-400',
    bad: 'text-rose-400',
    warn: 'text-amber-400',
    neutral: 'text-sky-400',
  };
  return (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <Icon className={`h-4 w-4 ${colors[tone]}`} />
      </div>
      <div className={`mt-1.5 font-mono text-xl font-semibold tabular-nums ${colors[tone]}`}>{value}</div>
      {hint && <div className="mt-1 text-[11px] text-slate-500">{hint}</div>}
    </div>
  );
};

export default function FinanceDashboard({ onToast }: { onToast?: (m: string) => void }) {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await api.financeSummary();
    if (res.status === 'success') setSummary(res.summary);
    else onToast?.('No se pudo cargar el resumen financiero.');
    setLoading(false);
  }, [onToast]);

  useEffect(() => {
    load();
  }, [load]);

  const s = summary;
  const maxStatus = Math.max(1, ...((s?.by_status || []).map((x: any) => x.amount) as number[]));
  const maxCategory = Math.max(1, ...((s?.by_category || []).map((x: any) => x.amount) as number[]));

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Dashboard Financiero y Contable</h1>
          <p className="mt-1 text-xs text-slate-400">
            Facturación emitida, cobranza conciliada, gastos, otros ingresos y saldo libre de gastos
            {s?.month ? ` · periodo ${s.month}` : ''}.
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

      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        <KPI
          label="Facturado"
          value={formatMoney(s?.invoiced_total)}
          hint={`${s?.invoices_count ?? 0} factura(s) emitidas`}
          icon={Receipt}
          tone="neutral"
        />
        <KPI
          label="Cobrado / Conciliado"
          value={formatMoney(s?.collected_total)}
          hint="Pagos validados y pasarelas"
          icon={Banknote}
          tone="good"
        />
        <KPI
          label="Por Cobrar"
          value={formatMoney(s?.pending_receivables)}
          hint={`${s?.overdue_invoices ?? 0} factura(s) vencidas`}
          icon={FileWarning}
          tone="bad"
        />
        <KPI
          label="Gastos"
          value={formatMoney(s?.expenses_total)}
          hint="Egresos registrados"
          icon={ArrowDownRight}
          tone="warn"
        />
        <KPI
          label="Otros Ingresos"
          value={formatMoney(s?.other_income_total)}
          hint="Conceptos fuera de mensualidad"
          icon={ArrowUpRight}
          tone="good"
        />
        <KPI label="Saldo Libre de Gastos" value={formatMoney(s?.net_balance)} hint="Cobrado + otros − gastos" icon={PiggyBank} tone="good" />
        <KPI
          label="Promesas de Pago"
          value={String(s?.promises_active ?? 0)}
          hint="Vigentes (no se corta el servicio)"
          icon={HandCoins}
          tone="warn"
        />
        <KPI label="Cuentas por Conciliar" value={String(s?.by_status?.find((x: any) => x.status === 'Pendiente')?.count ?? 0)} hint="Facturas pendientes" icon={Scale} tone="neutral" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="text-sm font-semibold text-slate-100">Facturación por Estado</h2>
          <p className="mb-4 text-[11px] text-slate-400">Monto acumulado según el estado contable de cada factura.</p>
          <div className="space-y-3">
            {((s?.by_status || []) as any[]).map((row) => (
              <div key={row.status}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-300">{row.status}</span>
                  <span className="font-mono tabular-nums text-slate-400">
                    {row.count} · {formatMoney(row.amount)}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-sky-500/80"
                    style={{ width: `${Math.round((row.amount / maxStatus) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {(!s?.by_status || s.by_status.length === 0) && <p className="text-xs text-slate-500">Sin facturas registradas.</p>}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-amber-400" />
            <h2 className="text-sm font-semibold text-slate-100">Gastos por Categoría</h2>
          </div>
          <p className="mb-4 text-[11px] text-slate-400">Distribución de egresos para el estado de resultados.</p>
          <div className="space-y-3">
            {((s?.by_category || []) as any[]).map((row) => (
              <div key={row.category}>
                <div className="mb-1 flex items-center justify-between text-xs">
                  <span className="text-slate-300">{row.category}</span>
                  <span className="font-mono tabular-nums text-slate-400">{formatMoney(row.amount)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-slate-800">
                  <div
                    className="h-full rounded-full bg-amber-500/80"
                    style={{ width: `${Math.round((row.amount / maxCategory) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
            {(!s?.by_category || s.by_category.length === 0) && (
              <p className="text-xs text-slate-500">Sin gastos registrados. Usa «Finanzas → Gastos» para agregar.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
