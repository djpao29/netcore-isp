import React, { useEffect, useState } from 'react';
import { Activity, HardDriveDownload, Power, RefreshCw, Router as RouterIcon, ShieldCheck, Terminal } from 'lucide-react';
import { api } from '../lib/api';

const TOOLS: Array<{ id: string; label: string; icon: React.ElementType }> = [
  { id: 'ping', label: 'Ping', icon: Activity },
  { id: 'torch', label: 'Torch', icon: Activity },
  { id: 'log', label: 'Log Router', icon: Terminal },
  { id: 'ppp-active', label: 'PPP Active Connections', icon: Activity },
  { id: 'arp', label: 'Lista ARP', icon: Activity },
  { id: 'dhcp-leases', label: 'DHCP Leases', icon: Activity },
  { id: 'ip-bindings', label: 'IP Bindings', icon: Activity },
  { id: 'address-list', label: 'Address Lists', icon: Activity },
  { id: 'pool-ipv6', label: 'Pool IPv6', icon: Activity },
  { id: 'backup', label: 'Backup automático', icon: HardDriveDownload },
  { id: 'reboot', label: 'Reiniciar router', icon: Power },
];

export default function RouterTools({ routers, onToast }: { routers: any[]; onToast?: (m: string) => void }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [output, setOutput] = useState<string>('');
  const [running, setRunning] = useState<string>('');

  useEffect(() => {
    if (!selectedId && routers.length) setSelectedId(String(routers[0].id));
  }, [routers, selectedId]);

  const selected = routers.find((r) => String(r.id) === selectedId);

  const run = async (tool: string) => {
    if (!selected) {
      onToast?.('Registra un router MikroTik en «Sistema → Routers MikroTik» para usar las herramientas.');
      return;
    }
    if (!selected.ip_address) {
      setOutput(`ERROR: el router "${selected.name}" no tiene IP de gestión configurada.`);
      return;
    }
    setRunning(tool);
    const res: any = await api.routerTool(selected.id, tool);
    setRunning('');
    if (res.status === 'success') {
      setOutput(
        `$ routeros-tool ${tool} --router "${res.router}"\n` +
          `# comando enviado: ${res.command || tool}\n` +
          `# filas devueltas: ${res.rows ?? 0}\n\n${res.output}`
      );
    } else {
      setOutput(`ERROR (RouterOS): ${res.message}`);
    }
  };

  const testConnection = async () => {
    if (!selected) return;
    if (!selected.ip_address) {
      setOutput(`ERROR: el router "${selected.name}" no tiene IP de gestión configurada.`);
      return;
    }
    setRunning('__test__');
    const res: any = await api.routerTest(selected.id);
    setRunning('');
    if (res.ok) {
      setOutput(
        `$ routeros-test --router "${selected.name}" (${selected.ip_address}:${selected.api_port || 8728})\n\n` +
          `OK  ${res.message}\n` +
          `identidad : ${res.identity || '—'}\n` +
          `RouterOS  : ${res.version || '—'}\n` +
          `board     : ${res.board || '—'}\n` +
          `uptime    : ${res.uptime || '—'}\n` +
          `cpu-load  : ${res.cpu_load || '—'}\n` +
          `free-mem  : ${res.free_memory || '—'}`
      );
    } else {
      setOutput(`ERROR (RouterOS): ${res.message}`);
    }
  };

  if (routers.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-800 bg-slate-900/60 py-20 text-center">
        <RouterIcon className="h-8 w-8 text-slate-600" />
        <h2 className="text-base font-semibold text-slate-200">Sin routers registrados</h2>
        <p className="max-w-md text-xs text-slate-400">
          Agrega tus RouterBOARDs en «Sistema → Routers MikroTik» (con IP, usuario y contraseña de API) para ejecutar
          Ping, Torch, Log, reinicio y respaldo contra el equipo real.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 border-b border-slate-800 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-slate-100">Herramientas de Router (RouterOS)</h1>
          <p className="mt-1 text-xs text-slate-400">
            Ejecuta comandos reales sobre tus RouterBOARDs por la API binaria de RouterOS (puerto 8728/8729), usando
            las credenciales guardadas en cada router.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-100"
          >
            {routers.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.ip_address}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={testConnection}
            disabled={running === '__test__'}
            className="flex items-center gap-2 rounded-lg border border-emerald-600/40 bg-emerald-600/10 px-3 py-2 text-xs font-medium text-emerald-300 hover:bg-emerald-600/20 disabled:opacity-50"
          >
            {running === '__test__' ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            Probar conexión
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 lg:col-span-1">
          <h2 className="mb-3 text-sm font-semibold text-slate-100">Herramientas disponibles</h2>
          <div className="space-y-1.5">
            {TOOLS.map((tool) => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => run(tool.id)}
                  disabled={running === tool.id}
                  className="flex w-full items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 hover:border-sky-500/40 hover:bg-slate-800 disabled:opacity-50"
                >
                  {running === tool.id ? <RefreshCw className="h-3.5 w-3.5 animate-spin" /> : <Icon className="h-3.5 w-3.5 text-sky-400" />}
                  {tool.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-950 p-4 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <Terminal className="h-4 w-4 text-emerald-400" />
            <h2 className="text-sm font-semibold text-slate-100">
              Consola {selected ? `· ${selected.name} (${selected.ip_address})` : ''}
            </h2>
          </div>
          <pre className="h-[360px] overflow-auto whitespace-pre-wrap rounded-lg border border-slate-800 bg-black/40 p-4 font-mono text-[11px] leading-relaxed text-emerald-300">
            {output || '// Selecciona una herramienta para ver la salida del router.'}
          </pre>
        </div>
      </div>
    </div>
  );
}
