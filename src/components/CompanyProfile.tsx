import React, { useEffect, useState } from 'react';
import { Building2, Save, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';

export default function CompanyProfile({ isp, onToast, onSaved }: { isp: any; onToast?: (m: string) => void; onSaved?: () => void }) {
  const [form, setForm] = useState<any>(isp || {});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm(isp || {});
  }, [isp]);

  if (!isp) {
    return <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-6 text-xs text-slate-400">Cargando datos de la empresa…</div>;
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res: any = await api.saveIsp(isp.id, form);
    setBusy(false);
    if (res.status === 'success') {
      onToast?.('Datos de la empresa actualizados.');
      onSaved?.();
    } else {
      onToast?.(res.message || 'No se pudieron guardar los datos.');
    }
  };

  const field = (name: string, label: string, type = 'text') => (
    <div>
      <label className="mb-1 block text-[11px] text-slate-300">{label}</label>
      <input
        type={type}
        value={form[name] ?? ''}
        onChange={(e) => setForm({ ...form, [name]: type === 'number' ? Number(e.target.value) : e.target.value })}
        className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100 focus:border-sky-500 focus:outline-none"
      />
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3 border-b border-slate-800 pb-5">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sky-500/15">
          <Building2 className="h-5 w-5 text-sky-400" />
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Mi Empresa</h1>
          <p className="mt-0.5 text-xs text-slate-400">
            Datos de la empresa, dominio del portal, moneda, zona horaria y parámetros de facturación y corte.
          </p>
        </div>
      </div>

      <form onSubmit={save} className="space-y-6">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-100">Identidad y dominios</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field('name', 'Nombre de la empresa')}
            {field('code', 'Código de empresa')}
            {field('domain', 'Dominio del panel')}
            {field('portal_domain', 'Dominio del portal del cliente')}
            {field('currency', 'Moneda (ISO)')}
            {field('currency_symbol', 'Símbolo de moneda')}
            {field('timezone', 'Zona horaria')}
            {field('plan_code', 'Plan / Licencia')}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
          <h2 className="mb-4 text-sm font-semibold text-slate-100">Facturación, corte y automatización</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {field('cut_day', 'Día de corte (1-28)', 'number')}
            {field('grace_days', 'Días de gracia', 'number')}
          </div>
          <div className="mt-3 flex flex-wrap gap-5 text-xs">
            <label className="inline-flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={!!form.auto_reactivate}
                onChange={(e) => setForm({ ...form, auto_reactivate: e.target.checked })}
                className="accent-sky-500"
              />
              Reactivación automática al registrar pago
            </label>
            <label className="inline-flex items-center gap-2 text-slate-300">
              <input
                type="checkbox"
                checked={!!form.ocr_auto_approve}
                onChange={(e) => setForm({ ...form, ocr_auto_approve: e.target.checked })}
                className="accent-sky-500"
              />
              Auto-aprobar comprobantes (lectura OCR no implementada)
            </label>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-emerald-500/30 bg-emerald-950/20 px-4 py-3 text-xs text-emerald-300">
          <span className="inline-flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" />
            Arquitectura multi-tenant · RBAC activo · sesión de Administrador
          </span>
          <button
            type="submit"
            disabled={busy}
            className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
          >
            <Save className="h-3.5 w-3.5" />
            {busy ? 'Guardando…' : 'Guardar datos'}
          </button>
        </div>
      </form>
    </div>
  );
}
