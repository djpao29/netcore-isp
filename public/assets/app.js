/* ============================================================================
 * NetCore ISP — Panel PHP (vanilla JS + Bootstrap 5)
 * CRUD genérico metadata-driven: usa /api/v1/modules para el árbol de módulos
 * y /api/v1/data/:module para los registros. Misma fuente de verdad que el
 * panel React (shared/modules.ts -> app/Generated/modules.json).
 * ========================================================================== */
'use strict';

const state = {
  groups: [],
  modules: [],
  moduleMap: {},
  counts: {},
  user: null,
  isp: null,
  activeKey: 'dashboard',
  rows: [],
  rowActions: {},
  navByGroup: {},
};
const openGroups = new Set();

const CSRF = document.querySelector('meta[name="csrf-token"]')?.content || '';

// ------------------------------------------------------------------ utilidades
async function api(path, options = {}) {
  const headers = Object.assign({ 'X-CSRF-Token': CSRF }, options.headers || {});
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const res = await fetch(path, Object.assign({ credentials: 'same-origin' }, options, { headers }));
  let json = null;
  try { json = await res.json(); } catch (_) { json = { status: 'error', message: 'Respuesta no válida (' + res.status + ').' }; }
  return json || {};
}

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function money(value, symbol = '$') {
  const n = Number(value) || 0;
  return symbol + n.toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('d-none');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add('d-none'), 4200);
}

function statusTone(value) {
  const v = String(value ?? '').toLowerCase();
  if (['activo', 'activa', 'online', 'pagada', 'validado', 'aprobado', 'enviado', 'cerrado', 'resuelto', 'firmado', 'disponible', 'conectado', 'cobrada'].includes(v)) return 'ok';
  if (['pendiente', 'moroso', 'warning', 'mantenimiento', 'en proceso', 'nuevo'].includes(v)) return 'warn';
  if (['suspendido', 'vencida', 'offline', 'rechazado', 'cancelada', 'inactivo', 'no cobrada'].includes(v)) return 'bad';
  return 'muted';
}

const INTEGRATION = {
  real: { label: 'Motor real', cls: 'ok', hint: 'Ejecuta una operación real contra un sistema desde este mismo código.' },
  config: { label: 'Requiere credenciales', cls: 'info', hint: 'El código de integración es real, pero necesita host/usuario/clave o API key.' },
  pending: { label: 'Pendiente de integración', cls: 'warn', hint: 'Guarda registros reales, pero su motor/proveedor externo aún no está implementado.' },
};

// ------------------------------------------------------------------ arranque
document.addEventListener('DOMContentLoaded', () => {
  // Tema claro/oscuro (funciona en login y panel)
  const themeToggle = document.getElementById('themeToggle');
  const themeIcon = document.getElementById('themeIcon');
  function applyTheme(t) {
    document.documentElement.setAttribute('data-theme', t);
    document.documentElement.setAttribute('data-bs-theme', t);
    if (themeIcon) themeIcon.textContent = (t === 'dark') ? '\u2600' : '\uD83C\uDF19';
    try { localStorage.setItem('netcore.theme', t); } catch (e) {}
  }
  applyTheme(localStorage.getItem('netcore.theme') || 'light');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme') || 'light';
      applyTheme(cur === 'dark' ? 'light' : 'dark');
    });
  }

  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(loginForm).entries());
      const res = await api('api/v1/auth/login', { method: 'POST', body: data });
      if (res.status === 'success') {
        window.location.reload();
      } else {
        const box = document.getElementById('loginError');
        box.textContent = res.message || 'No se pudo iniciar sesión.';
        box.classList.remove('d-none');
      }
    });
    return;
  }
  if (document.getElementById('navGroups')) initPanel();
});

async function initPanel() {
  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await api('api/v1/auth/logout', { method: 'POST' });
    try { localStorage.removeItem('netcore.activeKey'); } catch (e) {}
    window.location.reload();
  });

  const boot = await api('api/v1/bootstrap');
  if (boot.status !== 'success') { toast(boot.message || 'No se pudo cargar el panel.'); return; }

  state.groups = boot.groups || [];
  state.modules = boot.modules || [];
  state.counts = boot.counts || {};
  state.user = boot.user;
  state.isp = boot.isp;
  state.moduleMap = {};
  state.modules.forEach((m) => { state.moduleMap[m.key] = m; });

  document.getElementById('userInfo').textContent =
    (state.user ? state.user.name + ' · ' + state.user.email : '') + (state.isp ? ' · ' + (state.isp.name || '') : '');

  const storedKey = localStorage.getItem('netcore.activeKey');
  const knownCustom = new Set(['dashboard', 'router_tools', 'audit', 'customer_portal', 'php_code', 'api_docs', 'company_profile', 'finance_dashboard', 'customer_stats', 'mikrotik_olt']);
  if (storedKey && (state.moduleMap[storedKey] || knownCustom.has(storedKey))) {
    state.activeKey = storedKey;
  }
  selectModule(state.activeKey);
}

// ------------------------------------------------------------------ navegación
const CUSTOM_ITEMS = [
  { key: 'dashboard', label: 'Dashboard NOC', group: 'Dashboard', icon: '📊' },
  { key: 'router_tools', label: 'Herramientas de Router', group: 'Sistema', icon: '🛠️' },
  { key: 'audit', label: 'Auditoría', group: 'Ajustes', icon: '📝' },
];

function renderNav() {
  const nav = document.getElementById('navGroups');
  nav.innerHTML = '';
  const byGroup = {};
  CUSTOM_ITEMS.forEach((item) => { (byGroup[item.group] ||= []).push(Object.assign({ custom: true }, item)); });
  state.modules.forEach((m) => { (byGroup[m.group] ||= []).push({ key: m.key, label: m.label, count: state.counts[m.key] || 0 }); });
  state.navByGroup = byGroup;

  const order = ['Dashboard', ...state.groups];
  order.forEach((group) => {
    const items = byGroup[group];
    if (!items || !items.length) return;
    const wrap = document.createElement('div');
    wrap.className = 'nav-group';
    const title = document.createElement('button');
    title.type = 'button';
    title.className = 'nav-group-title';
    const isOpen = openGroups.has(group) || items.some((it) => it.key === state.activeKey);
    if (isOpen) openGroups.add(group);
    title.innerHTML = esc(group) + ' <span class="nav-group-caret">' + (isOpen ? '?' : '?') + '</span>';
    title.addEventListener('click', () => {
      if (openGroups.has(group)) openGroups.delete(group); else openGroups.add(group);
      const box = wrap.querySelector('.nav-group-items');
      if (box) box.style.display = openGroups.has(group) ? '' : 'none';
      title.querySelector('.nav-group-caret').textContent = openGroups.has(group) ? '?' : '?';
    });
    wrap.appendChild(title);
    const itemsBox = document.createElement('div');
    itemsBox.className = 'nav-group-items';
    if (!isOpen) itemsBox.style.display = 'none';
    items.forEach((item) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'nav-item' + (item.key === state.activeKey ? ' active' : '');
      btn.dataset.key = item.key;
      btn.innerHTML = '<span class="nav-item-label">' + esc((item.icon ? item.icon + ' ' : '') + item.label) + '</span>'
        + (item.count ? '<span class="nav-count">' + item.count + '</span>' : '');
      btn.addEventListener('click', () => selectModule(item.key));
      itemsBox.appendChild(btn);
    });
    wrap.appendChild(itemsBox);
    nav.appendChild(wrap);
  });
}

function markActive() {
  document.querySelectorAll('#navGroups .nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.key === state.activeKey);
  });
}

function selectModule(key) {
  state.activeKey = key;
  try { localStorage.setItem('netcore.activeKey', key); } catch (e) {}
  // Abre el grupo que contiene el módulo seleccionado
  const groups = state.navByGroup || {};
  for (const g in groups) {
    if (Array.isArray(groups[g]) && groups[g].some((it) => it.key === key)) { openGroups.add(g); }
  }
  if (document.getElementById('navGroups')) renderNav();
  markActive();
  if (key === 'dashboard') return renderDashboard();
  if (key === 'router_tools') return renderRouterTools();
  if (key === 'audit') return renderAudit();
  renderGenericModule(state.moduleMap[key]);
}

// ------------------------------------------------------------------ dashboard
function setBreadcrumb(group, label) {
  document.getElementById('breadcrumb').innerHTML = esc(group) + ' <span class="text-secondary">/</span> ' + esc(label);
}

async function renderDashboard() {
  setBreadcrumb('Dashboard', 'Dashboard NOC');
  const stats = await api('api/v1/customer-stats');
  const counts = state.counts || {};
  const byStatus = stats.by_status || {};

  const cards = [
    { label: 'Clientes', value: counts.customers || 0, icon: 'users', color: 'primary' },
    { label: 'Routers MikroTik', value: counts.routers || 0, icon: 'router', color: 'info' },
    { label: 'OLTs FTTH', value: counts.olts || 0, icon: 'olt', color: 'info' },
    { label: 'Tickets', value: counts.tickets || 0, icon: 'ticket', color: 'warning' },
    { label: 'Facturas', value: counts.invoices || 0, icon: 'invoice', color: 'primary' },
    { label: 'Pagos', value: counts.payments || 0, icon: 'payment', color: 'success' },
  ];

  const iconSvg = (name) => {
    const common = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
    const icons = {
      users: '<svg ' + common + '><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>',
      router: '<svg ' + common + '><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 12h.01M10 12h.01M14 12h.01M18 12h.01"/></svg>',
      olt: '<svg ' + common + '><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M9 9h6M9 12h6M9 15h6"/></svg>',
      ticket: '<svg ' + common + '><path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2z"/></svg>',
      invoice: '<svg ' + common + '><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/></svg>',
      payment: '<svg ' + common + '><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>',
    };
    return icons[name] || '';
  };

  const colorMap = {
    primary: { bg: 'var(--primary-soft)', fg: 'var(--primary)' },
    info: { bg: 'var(--info-soft)', fg: 'var(--info)' },
    warning: { bg: 'var(--warning-soft)', fg: 'var(--warning)' },
    success: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  };

  document.getElementById('content').innerHTML =
    '<div class="mb-4">'
    + '<h1 class="h4 mb-1">Dashboard NOC</h1>'
    + '<p class="text-secondary small mb-0">Resumen general del sistema y estado de los clientes.</p>'
    + '</div>'
    + '<div class="row g-3 mb-4">' + cards.map((c) => {
        const col = colorMap[c.color] || colorMap.primary;
        return '<div class="col-6 col-md-4 col-xl-2">'
          + '<div class="stat-card d-flex align-items-center gap-3">'
          + '<div class="d-flex align-items-center justify-content-center rounded-3" style="width:40px;height:40px;background:' + col.bg + ';color:' + col.fg + ';flex-shrink:0">' + iconSvg(c.icon) + '</div>'
          + '<div><div class="stat-label">' + esc(c.label) + '</div><div class="stat-value">' + c.value + '</div></div>'
          + '</div></div>';
      }).join('') + '</div>'
    + '<div class="panel-card">'
    + '<div class="d-flex align-items-center justify-content-between mb-3">'
    + '<h2 class="h6 mb-0">Clientes por estado</h2>'
    + '<span class="text-secondary small">' + (Object.keys(byStatus).length ? Object.values(byStatus).reduce((a,b)=>a+b,0) + ' clientes' : '') + '</span>'
    + '</div>'
    + (Object.keys(byStatus).length
        ? '<div class="d-flex flex-wrap gap-2">' + Object.entries(byStatus).map(([k, v]) =>
            '<span class="badge-tone ' + statusTone(k) + '">' + esc(k) + ' <strong class="ms-1">' + v + '</strong></span>').join('') + '</div>'
        : '<div class="text-secondary small">Aun no hay clientes registrados.</div>')
    + '</div>';
}

// ------------------------------------------------------------------ módulo genérico
function badge(text, tone) {
  return '<span class="badge-tone ' + (tone || 'muted') + '">' + esc(text ?? '—') + '</span>';
}

function cellHtml(row, col) {
  const value = row[col.name];
  if (col.type === 'badge') return badge(value, statusTone(value));
  if (col.type === 'money') return '<span class="mono">' + money(value) + '</span>';
  if (col.type === 'number') return '<span class="mono">' + (Number(value) || 0).toLocaleString('es') + '</span>';
  if (col.type === 'percent') return '<span class="mono">' + (Number(value) || 0) + '%</span>';
  if (col.type === 'mono') return '<span class="mono">' + esc(value ?? '—') + '</span>';
  return esc(value ?? '');
}

function integrationBadgeHtml(kind) {
  const meta = INTEGRATION[kind];
  if (!meta) return '';
  return '<span class="badge-tone ' + meta.cls + '" title="' + esc(meta.hint) + '">' + esc(meta.label) + '</span>';
}

async function renderGenericModule(mod) {
  if (!mod) return;
  setBreadcrumb(mod.group, mod.label);
  state.rows = [];
  const content = document.getElementById('content');
  const filterFields = (mod.fields || []).filter((f) => f.type === 'select' && (f.options || []).length).slice(0, 3);

  content.innerHTML =
    '<div class="d-flex flex-wrap justify-content-between align-items-start gap-2 mb-3">'
    + '<div><h1 class="h4 mb-1">' + esc(mod.label) + '</h1>'
    + '<p class="text-secondary small mb-1">' + esc(mod.description || '') + '</p>'
    + integrationBadgeHtml(mod.integration) + '</div>'
    + '<div class="d-flex gap-2">'
    + '<button class="btn btn-outline-secondary btn-sm" id="btnRefresh">Refrescar</button>'
    + '<button class="btn btn-outline-secondary btn-sm" id="btnCsv">CSV</button>'
    + '<button class="btn btn-primary btn-sm" id="btnNew">Nuevo</button>'
    + '</div></div>'
    + '<div class="d-flex flex-wrap gap-2 mb-3">'
    + '<input id="searchBox" class="form-control form-control-sm" style="max-width:280px" placeholder="Buscar en ' + esc(mod.label.toLowerCase()) + '...">'
    + filterFields.map((f) => '<select class="form-select form-select-sm" style="max-width:200px" data-filter="' + esc(f.name) + '"><option value="">' + esc(f.label) + ': todos</option>'
        + (f.options || []).map((o) => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('') + '</select>').join('')
    + '<span class="ms-auto small text-secondary align-self-center" id="rowCount"></span>'
    + '</div>'
    + '<div class="panel-card p-0"><div class="table-responsive"><table class="table table-hover align-middle mb-0" id="dataTable">'
    + '<thead><tr>' + (mod.columns || []).map((c) => '<th>' + esc(c.label) + '</th>').join('') + '<th class="text-end">Acciones</th></tr></thead>'
    + '<tbody></tbody></table></div></div>';

  document.getElementById('btnRefresh').addEventListener('click', () => loadRows(mod));
  document.getElementById('btnCsv').addEventListener('click', () => exportCsv(mod));
  document.getElementById('btnNew').addEventListener('click', () => openForm(mod, null));
  document.getElementById('searchBox').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadRows(mod); });
  content.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('change', () => loadRows(mod)));

  await loadRows(mod);
}

async function loadRows(mod) {
  const params = new URLSearchParams();
  const search = document.getElementById('searchBox')?.value?.trim();
  if (search) params.set('search', search);
  document.querySelectorAll('[data-filter]').forEach((el) => { if (el.value) params.set(el.dataset.filter, el.value); });
  const res = await api('api/v1/data/' + mod.key + '?' + params.toString());
  state.rows = res.rows || [];
  const tbody = document.querySelector('#dataTable tbody');
  tbody.innerHTML = '';
  if (!state.rows.length) {
    tbody.innerHTML = '<tr><td colspan="' + ((mod.columns || []).length + 1) + '" class="text-center text-secondary py-4">Sin registros todavía. Usa «Nuevo» para dar de alta el primer registro de ' + esc(mod.label) + '.</td></tr>';
  } else {
    state.rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = (mod.columns || []).map((c) => '<td>' + cellHtml(row, c) + '</td>').join('')
        + '<td class="text-end">' + (Array.isArray(mod.rowActions) ? mod.rowActions.map((a) => {
            if (a === 'invoice') return '<button class="btn btn-sm btn-outline-primary me-1" data-invoice>Facturar</button>';
            if (a === 'whatsapp') return '<button class="btn btn-sm btn-outline-success me-1" data-whatsapp>WhatsApp</button>';
            if (a === 'test') return '<button class="btn btn-sm btn-outline-info me-1" data-test-conn>Probar</button>';
            if (a === 'sync') return '<button class="btn btn-sm btn-outline-primary me-1" data-olt-sync>Sincronizar</button>';
            if (a === 'pay') return '<button class="btn btn-sm btn-outline-warning me-1" data-pay>Pagar</button>';
            if (a === 'download') return '<button class="btn btn-sm btn-outline-info me-1" data-download>Descargar</button>';
            if (a === 'command') return '<button class="btn btn-sm btn-outline-secondary me-1" data-olt-cmd>Telnet</button>';
            return '';
          }).join('') : '')
        + '<button class="btn btn-sm btn-outline-secondary me-1" data-edit>Editar</button>'
        + '<button class="btn btn-sm btn-outline-danger" data-del>Eliminar</button></td>';
      if (tr.querySelector('[data-invoice]')) {
        tr.querySelector('[data-invoice]').addEventListener('click', async () => {
          const r = await api('api/v1/customers/' + row.id + '/invoice', { method: 'POST' });
          toast(r.message || 'Operacion finalizada.');
          await loadRows(mod);
        });
      }
      if (tr.querySelector('[data-whatsapp]')) {
        tr.querySelector('[data-whatsapp]').addEventListener('click', async () => {
          const r = await api('api/v1/customers/' + row.id + '/invoice', { method: 'POST' });
          if (r.status !== 'success') { toast(r.message || 'No se pudo generar la factura.'); return; }
          const inv = r.row || {};
          const phone = String(row.phone || '').replace(/\D/g, '');
          const name = ((row.first_name || '') + ' ' + (row.last_name || '')).trim() || 'cliente';
          const msg = 'Hola ' + name + ', le enviamos su factura ' + (inv.invoice_number || inv.code || '') + ' por ' + (inv.total ?? '') + '. Vence el ' + (inv.due_date || '') + '. Gracias.';
          const url = 'https://wa.me/' + phone + '?text=' + encodeURIComponent(msg);
          window.open(url, '_blank');
          toast('Abriendo WhatsApp con la factura...');
        });
      }
      if (tr.querySelector('[data-test-conn]')) {
        tr.querySelector('[data-test-conn]').addEventListener('click', async () => {
          let endpoint = '';
          if (mod.key === 'routers') endpoint = 'api/v1/routers/' + row.id + '/test';
          else if (mod.key === 'olts') endpoint = 'api/v1/olts/' + row.id + '/test';
          const r = await api(endpoint, { method: 'POST' });
          toast(r.message || (r.ok ? 'Conexion OK.' : 'Sin respuesta.'));
        });
      }
      if (tr.querySelector('[data-olt-sync]')) {
        tr.querySelector('[data-olt-sync]').addEventListener('click', async () => {
          const r = await api('api/v1/olts/' + row.id + '/sync', { method: 'POST' });
          toast(r.message || 'Sincronizacion finalizada.');
          await loadRows(mod);
        });
      }
      if (tr.querySelector('[data-olt-cmd]')) {
        tr.querySelector('[data-olt-cmd]').addEventListener('click', async () => {
          const cmd = prompt('Comando Telnet para el OLT:');
          if (!cmd) return;
          const r = await api('api/v1/olts/' + row.id + '/command', { method: 'POST', body: { command: cmd } });
          if (r.status === 'success') { toast('Salida: ' + (r.output || '').slice(0, 120)); }
          else toast(r.message || 'Error en Telnet.');
        });
      }
      if (tr.querySelector('[data-pay]')) {
        tr.querySelector('[data-pay]').addEventListener('click', async () => {
          const r = await api('api/v1/data/invoices/' + row.id, { method: 'PUT', body: { status: 'Pagada', paid_amount: row.total } });
          // also try to find the invoice by customer if row is a customer? row here is invoice
          toast(r.message || 'Factura marcada como pagada.');
          await loadRows(mod);
        });
      }
      if (tr.querySelector('[data-download]')) {
        tr.querySelector('[data-download]').addEventListener('click', () => {
          const txt = 'FACTURA\\n'
            + 'Numero: ' + (row.invoice_number || row.code || '') + '\\n'
            + 'Cliente: ' + (row.customer_name || '') + '\\n'
            + 'Plan: ' + (row.plan_name || '') + '\\n'
            + 'Emision: ' + (row.issue_date || '') + '\\n'
            + 'Vencimiento: ' + (row.due_date || '') + '\\n'
            + 'Total: ' + (row.total ?? '') + '\\n'
            + 'Pagado: ' + (row.paid_amount ?? '') + '\\n'
            + 'Estado: ' + (row.status || '') + '\\n';
          const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = (row.invoice_number || row.code || 'factura') + '.txt';
          a.click();
          URL.revokeObjectURL(a.href);
          toast('Factura descargada.');
        });
      }
      tr.querySelector('[data-edit]').addEventListener('click', () => openForm(mod, row));
      tr.querySelector('[data-del]').addEventListener('click', async () => {
        if (!confirm('Eliminar el registro ' + (row.code || row.id) + ' de ' + mod.label + '?')) return;
        const r = await api('api/v1/data/' + mod.key + '/' + row.id, { method: 'DELETE' });
        toast(r.message || 'Operacion finalizada.');
        await loadRows(mod);
      });
      tbody.appendChild(tr);
    });
  }
  const countEl = document.getElementById('rowCount');
  if (countEl) countEl.textContent = state.rows.length + ' registro(s)';
}

function exportCsv(mod) {
  const cols = mod.columns || [];
  const esc2 = (v) => { const s = String(v ?? ''); return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const csv = [cols.map((c) => esc2(c.label)).join(',')]
    .concat(state.rows.map((r) => cols.map((c) => esc2(r[c.name])).join(','))).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = mod.key + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}

function fieldInput(field, value) {
  const common = 'form-control form-control-sm';
  if (field.type === 'textarea') return '<textarea class="' + common + '" rows="2" name="' + esc(field.name) + '">' + esc(value ?? '') + '</textarea>';
  if (field.type === 'select' && field.source) {
    const rows = sourceCache[field.source] || [];
    const sv = field.sourceValue || 'id';
    const sl = field.sourceLabel || 'name';
    let opts = '<option value="">— Seleccionar —</option>';
    opts += rows.map((r) => '<option value="' + esc(r[sv]) + '"' + (String(r[sv]) === String(value) ? ' selected' : '') + '>' + esc(r[sl]) + '</option>').join('');
    return '<select class="form-select form-select-sm" name="' + esc(field.name) + '">' + opts + '</select>';
  }
  if (field.type === 'select') return '<select class="form-select form-select-sm" name="' + esc(field.name) + '">'
    + (field.options || []).map((o) => '<option value="' + esc(o) + '"' + (String(o) === String(value) ? ' selected' : '') + '>' + esc(o) + '</option>').join('')
    + '</select>';
  const type = ['number', 'money', 'percent'].includes(field.type) ? 'number'
    : field.type === 'date' ? 'date'
    : field.type === 'time' ? 'time'
    : field.type === 'datetime' ? 'datetime-local'
    : field.type === 'password' ? 'password'
    : field.type === 'email' ? 'email'
    : field.type === 'tel' ? 'tel' : 'text';
  return '<input type="' + type + '" class="' + common + '" name="' + esc(field.name) + '" value="' + esc(value ?? '') + '"'
    + (field.type === 'money' || field.type === 'percent' ? ' step="0.01"' : '') + '>';
}

const sourceCache = {};
async function loadSource(key) {
  if (sourceCache[key]) return sourceCache[key];
  const r = await api('api/v1/data/' + key);
  sourceCache[key] = (r && r.rows) ? r.rows : [];
  return sourceCache[key];
}
async function loadSourcesFor(mod) {
  const keys = new Set();
  (mod.fields || []).forEach((f) => { if (f.source) keys.add(f.source); });
  await Promise.all(Array.from(keys).map(loadSource));
}
async function openForm(mod, row) {
  await loadSourcesFor(mod);
  const defaults = Object.assign({}, mod.defaults || {});
  const values = Object.assign({}, defaults, row || {});
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML =
    '<div class="modal-box"><div class="modal-head">'
    + '<div><div class="fw-semibold">' + (row ? 'Editar' : 'Nuevo registro') + ' · ' + esc(mod.label) + '</div>'
    + '<div class="text-secondary small">' + esc(mod.description || '') + '</div></div>'
    + '<button class="btn-close" id="mClose"></button></div>'
    + '<form id="mForm" class="modal-body"><div class="row g-2">'
    + (mod.fields || []).filter((f) => !f.hidden).map((f) => '<div class="col-12 ' + (f.type === 'textarea' ? '' : 'col-md-6') + '">'
        + '<label class="form-label small mb-1">' + esc(f.label) + (f.required ? ' <span class="text-danger">*</span>' : '') + '</label>'
        + fieldInput(f, values[f.name]) + '</div>').join('')
    + '</div><div class="d-flex justify-content-end gap-2 mt-3 modal-foot">'
    + '<button type="button" class="btn btn-outline-secondary btn-sm" id="mCancel">Cancelar</button>'
    + '<button type="submit" class="btn btn-primary btn-sm">' + (row ? 'Guardar cambios' : 'Crear registro') + '</button>'
    + '</div></form></div>';
  document.body.appendChild(overlay);

  // Actualización en vivo de campos compañeros al cambiar un select dinámico
  // (ej. al elegir zona se rellena el día de corte, editable después).
  (mod.fields || []).forEach((f) => {
    if (!f.source) return;
    const sel = overlay.querySelector('select[name="' + f.name + '"]');
    if (!sel) return;
    sel.addEventListener('change', () => {
      const rows = sourceCache[f.source] || [];
      const sv = f.sourceValue || 'id';
      const rec = rows.find((r) => String(r[sv]) === String(sel.value));
      if (!rec) return;
      if (f.companion) {
        const sl = f.sourceLabel || 'name';
        const comp = overlay.querySelector('[name="' + f.companion + '"]');
        if (comp) comp.value = rec[sl] ?? '';
      }
      if (Array.isArray(f.companions)) {
        f.companions.forEach((comp) => {
          const inp = overlay.querySelector('[name="' + comp.field + '"]');
          if (inp) inp.value = rec[comp.sourceField] ?? '';
        });
      }
    });
  });

  const close = () => overlay.remove();
  overlay.querySelector('#mClose').addEventListener('click', close);
  overlay.querySelector('#mCancel').addEventListener('click', close);
  overlay.querySelector('#mForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = {};
    new FormData(e.target).forEach((v, k) => { body[k] = v; });
    (mod.fields || []).forEach((f) => {
      if (!f.source || body[f.name] === undefined || body[f.name] === '') return;
      const rows = sourceCache[f.source] || [];
      const sv = f.sourceValue || 'id';
      const rec = rows.find((r) => String(r[sv]) === String(body[f.name]));
      if (!rec) return;
      if (f.companion && body[f.companion] === undefined) {
        const sl = f.sourceLabel || 'name';
        body[f.companion] = rec[sl];
      }
      if (Array.isArray(f.companions)) {
        f.companions.forEach((comp) => {
          if (body[comp.field] === undefined) body[comp.field] = rec[comp.sourceField];
        });
      }
    });
    const res = row
      ? await api('api/v1/data/' + mod.key + '/' + row.id, { method: 'PUT', body })
      : await api('api/v1/data/' + mod.key, { method: 'POST', body });
    if (res.status === 'success') { close(); toast(res.message || 'Guardado.'); Object.keys(sourceCache).forEach((k) => delete sourceCache[k]); await loadRows(mod); }
    else toast(res.message || 'No se pudo guardar.');
  });
}

// ------------------------------------------------------------------ herramientas de router
async function renderRouterTools() {
  setBreadcrumb('Sistema', 'Herramientas de Router');
  const res = await api('api/v1/data/routers');
  const routers = res.rows || [];
  const content = document.getElementById('content');
  const tools = ['ping', 'torch', 'log', 'ppp-active', 'arp', 'dhcp-leases', 'ip-bindings', 'address-list', 'pool-ipv6', 'backup', 'reboot'];

  content.innerHTML =
    '<h1 class="h4 mb-1">Herramientas de Router (RouterOS)</h1>'
    + '<p class="text-secondary small">Ejecuta comandos reales sobre tus RouterBOARDs por la API binaria de RouterOS (puerto 8728/8729).</p>'
    + (routers.length === 0
      ? '<div class="panel-card text-secondary small">Registra tus routers en «Sistema → Routers MikroTik» con IP, usuario y contraseña de API.</div>'
      : '<div class="d-flex flex-wrap gap-2 mb-3"><select id="routerSel" class="form-select form-select-sm" style="max-width:320px">'
        + routers.map((r) => '<option value="' + r.id + '">' + esc(r.name + ' · ' + (r.ip_address || '')) + '</option>').join('')
        + '</select><button class="btn btn-sm btn-outline-success" id="btnTest">Probar conexión</button></div>'
        + '<div class="row g-3"><div class="col-lg-4"><div class="panel-card"><div class="d-flex flex-wrap gap-2">'
        + tools.map((t) => '<button class="btn btn-sm btn-outline-info" data-tool="' + t + '">' + t + '</button>').join('')
        + '</div></div></div><div class="col-lg-8"><div class="panel-card"><pre id="toolOut" class="tool-console">// Selecciona una herramienta para ver la salida del router.</pre></div></div></div>');

  if (routers.length === 0) return;
  const out = () => document.getElementById('toolOut');
  const routerId = () => document.getElementById('routerSel').value;

  content.querySelectorAll('[data-tool]').forEach((btn) => btn.addEventListener('click', async () => {
    out().textContent = 'Ejecutando ' + btn.dataset.tool + '…';
    const r = await api('api/v1/routers/' + routerId() + '/tool', { method: 'POST', body: { tool: btn.dataset.tool } });
    out().textContent = r.status === 'success' ? (r.text || '') : ('ERROR: ' + (r.message || 'fallo'));
  }));
  document.getElementById('btnTest').addEventListener('click', async () => {
    out().textContent = 'Probando conexión…';
    const r = await api('api/v1/routers/' + routerId() + '/test', { method: 'POST' });
    out().textContent = r.ok
      ? ('OK ' + r.message + '\nidentidad: ' + (r.identity || '—') + '\nRouterOS: ' + (r.version || '—') + '\nboard: ' + (r.board || '—') + '\nuptime: ' + (r.uptime || '—') + '\ncpu-load: ' + (r.cpu_load || '—'))
      : ('ERROR: ' + (r.message || 'fallo'));
  });
}


// ------------------------------------------------------------------ auditoría
async function renderAudit() {
  setBreadcrumb('Ajustes', 'Auditoría');
  const res = await api('api/v1/audit');
  const rows = res.rows || [];
  document.getElementById('content').innerHTML =
    '<h1 class="h4 mb-1">Auditoría</h1>'
    + '<p class="text-secondary small">Registro de acciones del panel y ejecuciones CRON.</p>'
    + '<div class="panel-card p-0"><div class="table-responsive"><table class="table table-sm align-middle mb-0"><thead><tr>'
    + '<th>Fecha</th><th>Usuario</th><th>Acción</th><th>Módulo</th><th>Registro</th><th>Detalle</th></tr></thead><tbody>'
    + (rows.length ? rows.map((r) => '<tr><td class="mono small">' + esc(r.created_at) + '</td><td>' + esc(r.user_name) + '</td><td>' + esc(r.action) + '</td><td>' + esc(r.module_name) + '</td><td class="mono small">' + esc(r.record_id) + '</td><td>' + esc(r.details) + '</td></tr>').join('')
        : '<tr><td colspan="6" class="text-center text-secondary py-4">Sin eventos registrados.</td></tr>')
    + '</tbody></table></div></div>';
}
