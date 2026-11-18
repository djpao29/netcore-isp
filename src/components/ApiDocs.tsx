import React, { useState } from 'react';
import { KeyRound, Copy, Check, Globe } from 'lucide-react';

interface Endpoint {
  method: string;
  path: string;
  desc: string;
}

interface Group {
  name: string;
  endpoints: Endpoint[];
}

// NOTA DE HONESTIDAD: aquí solo se documentan endpoints realmente
// implementados en server.ts y server.modules.ts. Los módulos cuyo nombre
// incluye "simulado" NO se conectan a sistemas externos: solo guardan datos.
const GROUPS: Group[] = [
  {
    name: 'Sistema / catálogo',
    endpoints: [
      { method: 'GET', path: '/api/v1/bootstrap', desc: 'Carga inicial: todas las colecciones del sistema.' },
      { method: 'GET', path: '/api/v1/modules', desc: 'Catálogo completo de los 52 módulos y su metadata.' },
      { method: 'GET', path: '/api/v1/metrics', desc: 'Conteo de registros por módulo (para el menú).' },
    ],
  },
  {
    name: 'Módulos genéricos (CRUD real, persistido en disco)',
    endpoints: [
      { method: 'GET', path: '/api/v1/data/{module}', desc: 'Lista registros de cualquier módulo. Params: search, limit, filtros.' },
      { method: 'GET', path: '/api/v1/data/{module}/{id}', desc: 'Obtiene un registro.' },
      { method: 'POST', path: '/api/v1/data/{module}', desc: 'Crea un registro. Devuelve el código generado.' },
      { method: 'PUT', path: '/api/v1/data/{module}/{id}', desc: 'Actualiza un registro.' },
      { method: 'DELETE', path: '/api/v1/data/{module}/{id}', desc: 'Elimina un registro.' },
      { method: 'POST', path: '/api/v1/data/{module}/bulk', desc: 'Acciones masivas: { action: "delete" | "set", ids, payload }.' },
    ],
  },
  {
    name: 'Clientes e inventario de red',
    endpoints: [
      { method: 'POST', path: '/api/v1/customers', desc: 'Crea cliente + CPE en el inventario (NO provisiona router real).' },
      { method: 'POST', path: '/api/v1/customers/{id}/toggle-status', desc: 'Marca Activo/Suspendido en la BD (no corta el router real).' },
      { method: 'GET', path: '/api/v1/network-inventory', desc: 'Lista el inventario de red con filtros.' },
      { method: 'POST', path: '/api/v1/network-inventory/{id}/ping', desc: 'Comprueba alcance TCP real (socket) contra el equipo.' },
    ],
  },
  {
    name: 'Facturación, pagos y contabilidad (cálculos reales)',
    endpoints: [
      { method: 'GET', path: '/api/v1/finance/summary', desc: 'Resumen financiero: facturado, cobrado, gastos y saldo.' },
      { method: 'GET', path: '/api/v1/accounting/summary', desc: 'Estado de resultados y balance general (calculados).' },
      { method: 'GET', path: '/api/v1/customer-stats', desc: 'Estadísticas de clientes por estado, zona y sector.' },
      { method: 'POST', path: '/api/v1/payment-proofs/{id}/review', desc: 'Aprueba/rechaza comprobante y registra el pago (workflow interno).' },
      { method: 'POST', path: '/api/v1/cron/run', desc: 'Genera facturas, marca vencidas y aplica cortes en la BD.' },
    ],
  },
  {
    name: 'Operación (parcialmente simulado)',
    endpoints: [
      { method: 'POST', path: '/api/v1/routers/{id}/tool', desc: 'SIMULADO: devuelve texto fijo, no ejecuta en RouterOS real.' },
      { method: 'POST', path: '/api/v1/ai/chat', desc: 'Asistente IA sobre datos reales (Gemini si hay API key; si no, reporte determinista).' },
    ],
  },
  {
    name: 'Importación',
    endpoints: [
      { method: 'GET', path: '/api/v1/import/template', desc: 'Descarga plantilla CSV por entidad.' },
      { method: 'POST', path: '/api/v1/import', desc: 'Importa JSON multi-sección o CSV a la base de datos.' },
    ],
  },
];

const METHOD_TONE: Record<string, string> = {
  GET: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
  POST: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  PUT: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  DELETE: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

export default function ApiDocs({ onToast }: { onToast?: (m: string) => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const base = typeof window !== 'undefined' ? window.location.origin : 'https://panel.miisp.com';

  const copy = (text: string) => {
    navigator.clipboard?.writeText(text);
    setCopied(text);
    onToast?.('Copiado al portapapeles.');
    window.setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-slate-800 pb-5">
        <h1 className="text-xl font-semibold tracking-tight text-slate-100">API Pública</h1>
        <p className="mt-1 text-xs text-slate-400">
          Integra tu plataforma con NetCore ISP mediante HTTP + JSON. Todas las respuestas incluyen <code>status</code> y
          los errores devuelven <code>message</code>.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <Globe className="h-4 w-4 text-sky-400" />
            URL base
          </div>
          <button
            type="button"
            onClick={() => copy(base)}
            className="flex w-full items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-xs text-slate-200 hover:border-sky-500/50"
          >
            <span>{base}</span>
            {copied === base ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 text-slate-500" />}
          </button>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">
            <KeyRound className="h-4 w-4 text-amber-400" />
            Autenticación
          </div>
          <div className="rounded-lg border border-amber-500/40 bg-amber-950/30 p-3 text-[11px] text-amber-200">
            Aún <strong>no hay autenticación implementada</strong>. La API responde sin token (uso en localhost /
            desarrollo). Antes de exponerla en Internet debes añadir login y proteger las rutas.
          </div>
          <p className="text-xs text-slate-400">
            Los tokens se administran como datos en «Sistema → API de WispHub», pero todavía no se validan en cada
            petición.
          </p>
          <pre className="rounded-lg border border-slate-800 bg-slate-950 p-3 font-mono text-[11px] text-emerald-300 overflow-x-auto">
{`Content-Type: application/json
# (sin Authorization todavía)`}
          </pre>
        </div>
      </div>

      <div className="space-y-5">
        {GROUPS.map((group) => (
          <div key={group.name} className="overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60">
            <div className="border-b border-slate-800 bg-slate-950/60 px-4 py-3 text-xs font-semibold text-slate-200">
              {group.name}
            </div>
            <div className="divide-y divide-slate-800/70">
              {group.endpoints.map((ep) => (
                <div key={`${ep.method}-${ep.path}`} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <span className={`inline-flex w-16 justify-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${METHOD_TONE[ep.method] || METHOD_TONE.GET}`}>
                    {ep.method}
                  </span>
                  <button
                    type="button"
                    onClick={() => copy(`${base}${ep.path}`)}
                    className="font-mono text-xs text-sky-300 hover:underline text-left"
                  >
                    {ep.path}
                  </button>
                  <span className="text-xs text-slate-400 sm:ml-auto sm:max-w-md">{ep.desc}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="mb-2 text-sm font-semibold text-slate-100">Ejemplo rápido (cURL)</h2>
        <pre className="rounded-lg border border-slate-800 bg-slate-950 p-4 font-mono text-[11px] text-slate-200 overflow-x-auto">
{`curl -X GET "${base}/api/v1/data/customers?search=Juan&limit=50" \\
  -H "Content-Type: application/json"`}
        </pre>
      </div>
    </div>
  );
}
