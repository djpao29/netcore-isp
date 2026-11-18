const fs = require('fs');
let content = fs.readFileSync('src/App.tsx', 'utf8');

const oldSection = `activeModule === 'dashboard' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                    Panel Administrativo e Indicadores NOC / Facturación
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Monitoreo en tiempo real de clientes, recaudación, routers MikroTik, OLTs FTTH, inventario de red y tareas CRON.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={loadBootstrap}
                  className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                >
                  <RefreshCw className={\`h-3.5 w-3.5 \${loading ? 'animate-spin' : ''}\`} />
                  Refrescar por AJAX
                </button>
              </div>

              {/* 12 Primary KPIs Grid */}
              `;

const newSection = `activeModule === 'dashboard' && (
            <div className="space-y-6">
              {/* Enhanced Header with Live Controls */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                    Panel Administrativo e Indicadores NOC / Facturación
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Monitoreo en tiempo real de clientes, recaudación, routers MikroTik, OLTs FTTH, inventario de red y tareas CRON.
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  {/* Auto-refresh toggle */}
                  <label className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-xs text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRefresh}
                      onChange={(e) => setAutoRefresh(e.target.checked)}
                      className="accent-sky-500"
                    />
                    <span>Auto-refresh</span>
                    {autoRefresh && (
                      <span className="inline-flex items-center gap-1 ml-2 text-[10px] text-emerald-400">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                        ACTIVO
                      </span>
                    )}
                  </label>
                  
                  {/* Refresh interval */}
                  <select
                    value={refreshInterval}
                    onChange={(e) => setRefreshInterval(Number(e.target.value))}
                    disabled={!autoRefresh}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value={10}>10s</option>
                    <option value={30}>30s</option>
                    <option value={60}>1min</option>
                    <option value={120}>2min</option>
                    <option value={300}>5min</option>
                  </select>

                  {/* Live status summary */}
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700">
                    <span className="text-[10px] text-slate-400">Estado:</span>
                    {routers.map((r) => (
                      <span key={"router-" + r.id} className="flex items-center gap-1" title={r.name}>
                        <span className={"w-2 h-2 rounded-full " + (liveStatus["router-" + r.id]?.online ? "bg-emerald-500" : "bg-rose-500")} />
                        <span className="text-[10px] font-mono">{liveStatus["router-" + r.id]?.lastCheck || "—"}</span>
                      </span>
                    ))}
                    {olts.map((o) => (
                      <span key={"olt-" + o.id} className="flex items-center gap-1" title={o.name}>
                        <span className={"w-2 h-2 rounded-full " + (liveStatus["olt-" + o.id]?.online ? "bg-emerald-500" : "bg-rose-500")} />
                        <span className="text-[10px] font-mono">{liveStatus["olt-" + o.id]?.lastCheck || "—"}</span>
                      </span>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={loadBootstrap}
                    className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3.5 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                  >
                    <RefreshCw className={\`h-3.5 w-3.5 \${loading ? 'animate-spin' : ''}\`} />
                    Refrescar ahora
                  </button>
                </div>
              </div>

              {/* Notifications Panel */}
              {notifications.length > 0 && (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-amber-300 flex items-center gap-1">
                      <AlertTriangle className="h-3 w-3" />
                      Alertas del Sistema ({notifications.filter(n => !n.read).length} nuevas)
                    </span>
                    <button
                      onClick={() => setNotifications(n => n.map(x => ({...x, read: true})))}
                      className="text-[10px] text-slate-400 hover:text-slate-200"
                    >
                      Marcar todas como leídas
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {notifications.map((n) => (
                      <span
                        key={n.id}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium " +
                          (n.type === "warning" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                           n.type === "danger" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" :
                           "bg-sky-500/20 text-sky-300 border border-sky-500/30")
                      >
                        {n.message} <span className="text-slate-500">{n.time}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Quick Actions */}
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => setActiveModule("data:customers")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                >
                  <Plus className="h-3 w-3" /> Nuevo Cliente
                </button>
                <button
                  onClick={() => setActiveModule("data:invoices")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
                >
                  <FileCheck2 className="h-3 w-3" /> Nueva Factura
                </button>
                <button
                  onClick={() => setActiveModule("billing_ocr")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
                >
                  <Receipt className="h-3 w-3" /> Registrar Pago
                </button>
                <button
                  onClick={() => setActiveModule("network_inventory")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-purple-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-purple-400"
                >
                  <RadioTower className="h-3 w-3" /> Agregar Dispositivo
                </button>
                <button
                  onClick={() => setActiveModule("data:olts")}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-indigo-400"
                >
                  <Cable className="h-3 w-3" /> Registrar OLT
                </button>
              </div>

              {/* 12 Primary KPIs Grid */}
              `;

if (content.includes(oldSection)) {
  content = content.replace(oldSection, newSection);
  fs.writeFileSync('src/App.tsx', content);
  console.log('SUCCESS: Dashboard section updated');
} else {
  console.log('ERROR: Could not find the section to replace');
}