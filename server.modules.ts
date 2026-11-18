// ============================================================================
//  Rutas genéricas metadata-driven para todos los módulos del sistema.
//  Un solo motor CRUD sirve a ~40 módulos definidos en shared/modules.ts,
//  más endpoints especializados (finanzas, tickets, router, masivas).
// ============================================================================
import type { Express, Request, Response } from 'express';
import {
  GROUP_ORDER,
  MODULE_MAP,
  MODULE_REGISTRY,
  buildCode,
  nextId,
  type FieldDef,
  type ModuleDef,
} from './shared/modules';
import { runRouterTool, testRouterConnection, type RouterCreds } from './mikrotik';
import { MikrotikTrafficDriver } from './src/drivers/MikrotikTrafficDriver';
import { FreeRadiusProvider } from './src/drivers/FreeRadiusDriver';

/** Construye las credenciales RouterOS reales a partir del registro del router. */
export function routerCreds(router: any): RouterCreds {
  const port = Number(router.api_port) || 8728;
  const tls = port === 8729 || router.use_tls === true || router.use_tls === 'Sí' || router.use_tls === 'Si';
  return {
    host: String(router.ip_address || '').trim(),
    port,
    user: String(router.username || 'admin').trim(),
    password: String(router.password ?? ''),
    tls,
    timeoutMs: 8000,
  };
}

type Db = Record<string, any>;

export interface ModuleRouteDeps {
  loadDb: () => Db;
  saveDb: (db: Db) => void;
  appendAudit: (
    db: Db,
    ispId: number,
    userName: string,
    action: string,
    moduleName: string,
    recordId: string,
    details: string
  ) => void;
}

const NOISE_FIELDS = new Set(['id', 'search', 'limit', 'offset', 'sort', 'order', 'q']);

function coerce(mod: ModuleDef, body: Record<string, any>, existing: Record<string, any> = {}) {
  const out: Record<string, any> = { ...existing };
  for (const field of mod.fields) {
    if (!(field.name in body)) continue;
    out[field.name] = coerceValue(field, body[field.name]);
  }
  return out;
}

function coerceValue(field: FieldDef, raw: any) {
  if (field.type === 'number' || field.type === 'money' || field.type === 'percent') {
    if (raw === '' || raw === null || raw === undefined) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }
  if (field.type === 'checkbox') {
    return raw === true || raw === 'true' || raw === 'Sí' || raw === 'si' || raw === 1;
  }
  if (raw === null || raw === undefined) return '';
  return String(raw);
}

function applyFilters(rows: any[], mod: ModuleDef, query: Record<string, any>) {
  let result = rows;

  // Búsqueda libre
  const search = String(query.search || query.q || '').trim().toLowerCase();
  if (search) {
    const fields = mod.search.length ? mod.search : mod.columns.map((col) => col.name);
    result = result.filter((row) =>
      fields.some((field) => String(row[field] ?? '').toLowerCase().includes(search))
    );
  }

  // Filtros exactos por nombre de campo (case-insensitive)
  for (const [key, rawValue] of Object.entries(query)) {
    if (NOISE_FIELDS.has(key)) continue;
    const value = String(rawValue ?? '').trim();
    if (!value) continue;
    const exists = mod.columns.some((col) => col.name === key) || mod.fields.some((fld) => fld.name === key);
    if (!exists) continue;
    result = result.filter((row) => String(row[key] ?? '').toLowerCase() === value.toLowerCase());
  }

  // Ordenamiento
  const sortKey = String(query.sort || '');
  if (sortKey) {
    const dir = String(query.order || 'asc').toLowerCase() === 'desc' ? -1 : 1;
    result = [...result].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
    });
  }

  const limit = Number(query.limit || 0);
  if (limit > 0) result = result.slice(0, limit);
  return result;
}

export function registerModuleRoutes(app: Express, deps: ModuleRouteDeps) {
  const { loadDb, saveDb, appendAudit } = deps;

  // ------------------------------------------------------------------
  // Catálogo de módulos (metadata) — usada por el frontend
  // ------------------------------------------------------------------
  app.get('/api/v1/modules', (_req: Request, res: Response) => {
    res.json({ status: 'success', groups: GROUP_ORDER, modules: MODULE_REGISTRY });
  });

  // ------------------------------------------------------------------
  // LISTAR
  // ------------------------------------------------------------------
  app.get('/api/v1/data/:moduleName', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: `Módulo desconocido: ${req.params.moduleName}` });
    const db = loadDb();
    const rows = Array.isArray(db[mod.key]) ? db[mod.key] : [];
    const filtered = applyFilters(rows, mod, req.query as Record<string, any>);
    return res.json({ status: 'success', module: mod, total: filtered.length, grand_total: rows.length, rows: filtered });
  });

  // ------------------------------------------------------------------
  // OBTENER UNO
  // ------------------------------------------------------------------
  app.get('/api/v1/data/:moduleName/:id', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: 'Módulo desconocido.' });
    const db = loadDb();
    const row = (db[mod.key] || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!row) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    return res.json({ status: 'success', module: mod, row });
  });

  // ------------------------------------------------------------------
  // CREAR
  // ------------------------------------------------------------------
  app.post('/api/v1/data/:moduleName', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: 'Módulo desconocido.' });
    const db = loadDb();
    if (!Array.isArray(db[mod.key])) db[mod.key] = [];

    const missing = mod.fields.filter((fld) => fld.required && !String(req.body?.[fld.name] ?? '').trim());
    if (missing.length) {
      return res.status(422).json({
        status: 'error',
        message: `Campos obligatorios faltantes: ${missing.map((f) => f.label).join(', ')}.`,
      });
    }

    const id = nextId(mod.key, db[mod.key] || []);
    const record = {
      ...(mod.defaults || {}),
      ...coerce(mod, req.body || {}),
      id,
      isp_id: 1,
      code: String(req.body?.code || buildCode(mod.key, Number(id))),
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };

    db[mod.key].unshift(record);
    appendAudit(db, 1, 'API', 'CREATE', mod.label, record.code, `Alta en ${mod.label}: ${record.code}`);
    saveDb(db);
    return res.status(201).json({ status: 'success', message: `${mod.label}: registro ${record.code} creado.`, row: record });
  });

  // ------------------------------------------------------------------
  // Factura por cliente (generación individual, real)
  // ------------------------------------------------------------------
  app.post('/api/v1/customers/:id/invoice', (req: Request, res: Response) => {
    const db = loadDb();
    if (!Array.isArray(db.customers)) db.customers = [];
    if (!Array.isArray(db.invoices)) db.invoices = [];
    const customer = (db.customers || []).find((c: any) => String(c.id) === String(req.params.id));
    if (!customer) return res.status(404).json({ status: 'error', message: 'Cliente no encontrado.' });

    const month = new Date().toISOString().slice(0, 7);
    const existing = (db.invoices || []).find((inv: any) => String(inv.customer_id) === String(customer.id) && String(inv.issue_date || '').startsWith(month));
    if (existing) return res.json({ status: 'success', message: 'Ya existe una factura para este mes.', row: existing, created: false });

    const plans = db.plans || [];
    const plan = plans.find((p: any) => String(p.id) === String(customer.plan_id));
    const total = Number(plan?.price_monthly || 0);
    const id = nextId('invoices', db.invoices || []);
    const code = buildCode('invoices', Number(id));
    const record: any = {
      ...(MODULE_MAP.invoices.defaults || {}),
      customer_id: customer.id,
      customer_name: `${customer.first_name || ''} ${customer.last_name || ''}`.trim(),
      plan_name: plan?.name || customer.plan_name || 'Sin plan asignado',
      issue_date: new Date().toISOString().slice(0, 10),
      due_date: new Date().toISOString().slice(0, 7) + '-05',
      subtotal: total,
      tax_amount: 0,
      total,
      status: 'Pendiente',
      id,
      isp_id: 1,
      code,
      invoice_number: code,
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    db.invoices.unshift(record);
    appendAudit(db, 1, 'API', 'CREATE', 'Facturas', record.code, `Factura generada para ${record.customer_name}.`);
    saveDb(db);
    return res.status(201).json({ status: 'success', message: 'Factura generada.', row: record, created: true });
  });

  // ------------------------------------------------------------------
  // ACTUALIZAR
  // ------------------------------------------------------------------
  app.put('/api/v1/data/:moduleName/:id', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: 'Módulo desconocido.' });
    const db = loadDb();
    const rows = db[mod.key] || [];
    const idx = rows.findIndex((r: any) => String(r.id) === String(req.params.id));
    if (idx === -1) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });

    const updated: any = {
      ...coerce(mod, req.body || {}, rows[idx]),
      updated_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    rows[idx] = updated;
    appendAudit(db, 1, 'API', 'UPDATE', mod.label, updated.code, `Actualización en ${mod.label}: ${updated.code}`);
    saveDb(db);
    return res.json({ status: 'success', message: `${mod.label}: registro actualizado.`, row: updated });
  });

  // ------------------------------------------------------------------
  // ELIMINAR
  // ------------------------------------------------------------------
  app.delete('/api/v1/data/:moduleName/:id', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: 'Módulo desconocido.' });
    const db = loadDb();
    const rows = db[mod.key] || [];
    const target = rows.find((r: any) => String(r.id) === String(req.params.id));
    if (!target) return res.status(404).json({ status: 'error', message: 'Registro no encontrado.' });
    db[mod.key] = rows.filter((r: any) => String(r.id) !== String(req.params.id));
    appendAudit(db, 1, 'API', 'DELETE', mod.label, target.code, `Eliminación en ${mod.label}: ${target.code}`);
    saveDb(db);
    return res.json({ status: 'success', message: `${mod.label}: registro eliminado.` });
  });

  // ------------------------------------------------------------------
  // ACCIONES MASIVAS
  // ------------------------------------------------------------------
  app.post('/api/v1/data/:moduleName/bulk', (req: Request, res: Response) => {
    const mod = MODULE_MAP[req.params.moduleName];
    if (!mod) return res.status(404).json({ status: 'error', message: 'Módulo desconocido.' });
    const db = loadDb();
    const rows = db[mod.key] || [];
    const ids: Array<string | number> = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    const action = String(req.body?.action || '');
    const payload = req.body?.payload || {};

    if (!ids.length) return res.status(422).json({ status: 'error', message: 'No se seleccionaron registros.' });
    let affected = 0;

    if (action === 'delete') {
      db[mod.key] = rows.filter((r: any) => !ids.includes(String(r.id)));
      affected = rows.length - db[mod.key].length;
    } else if (action === 'set') {
      for (const row of rows) {
        if (!ids.includes(String(row.id))) continue;
        Object.assign(row, coerce(mod, payload, row));
        affected++;
      }
    } else {
      return res.status(422).json({ status: 'error', message: `Acción masiva no soportada: ${action}` });
    }

    appendAudit(db, 1, 'API', 'BULK', mod.label, `${affected} registros`, `Acción masiva ${action} sobre ${affected} registro(s) de ${mod.label}.`);
    saveDb(db);
    return res.json({ status: 'success', message: `Acción masiva aplicada a ${affected} registro(s).`, affected });
  });

  // ------------------------------------------------------------------
  // ENDPOINTS ESPECIALIZADOS
  // ------------------------------------------------------------------

  // Resumen financiero (Dashboard Finanzas / Contabilidad)
  app.get('/api/v1/finance/summary', (_req: Request, res: Response) => {
    const db = loadDb();
    const invoices: any[] = db.invoices || [];
    const payments: any[] = db.payments || [];
    const expenses: any[] = db.expenses || [];
    const otherIncome: any[] = db.other_income || [];
    const promises: any[] = db.payment_promises || [];
    const month = new Date().toISOString().slice(0, 7);

    const invoiced = invoices.reduce((acc, i) => acc + Number(i.total || 0), 0);
    const collected = payments.reduce((acc, p) => acc + Number(p.amount || 0), 0);
    const pending = invoices
      .filter((i) => i.status === 'Pendiente' || i.status === 'Vencida')
      .reduce((acc, i) => acc + Number(i.total || 0), 0);
    const expensesTotal = expenses.reduce((acc, e) => acc + Number(e.amount || 0), 0);
    const otherTotal = otherIncome.reduce((acc, o) => acc + Number(o.amount || 0), 0);

    res.json({
      status: 'success',
      summary: {
        month,
        invoiced_total: invoiced,
        collected_total: collected,
        pending_receivables: pending,
        expenses_total: expensesTotal,
        other_income_total: otherTotal,
        net_balance: collected + otherTotal - expensesTotal,
        promises_active: promises.filter((p) => p.status === 'Pendiente').length,
        invoices_count: invoices.length,
        overdue_invoices: invoices.filter((i) => i.status === 'Vencida').length,
        by_status: ['Pendiente', 'Pagada', 'Vencida', 'Cancelada'].map((status) => ({
          status,
          count: invoices.filter((i) => i.status === status).length,
          amount: invoices.filter((i) => i.status === status).reduce((a, i) => a + Number(i.total || 0), 0),
        })),
        by_category: Object.entries(
          expenses.reduce((acc: Record<string, number>, e: any) => {
            const key = e.category || 'Sin categoría';
            acc[key] = (acc[key] || 0) + Number(e.amount || 0);
            return acc;
          }, {})
        ).map(([category, amount]) => ({ category, amount })),
      },
    });
  });

  // Contabilidad: Estado de Resultados y Balance General (derivados de datos reales)
  app.get('/api/v1/accounting/summary', (_req: Request, res: Response) => {
    const db = loadDb();
    const payments: any[] = db.payments || [];
    const otherIncome: any[] = db.other_income || [];
    const invoices: any[] = db.invoices || [];
    const expenses: any[] = db.expenses || [];
    const assets: any[] = db.depreciations || [];
    const bankAccounts: any[] = db.bank_accounts || [];

    const collected = payments.reduce((a, p) => a + Number(p.amount || 0), 0);
    const other = otherIncome.filter((o) => o.status !== 'Cancelado').reduce((a, o) => a + Number(o.amount || 0), 0);
    const incomeTotal = collected + other;

    const expenseRows = expenses.filter((e) => e.status !== 'Cancelado');
    const expenseTotal = expenseRows.reduce((a, e) => a + Number(e.amount || 0), 0);
    const profit = incomeTotal - expenseTotal;

    // Estado de resultados agrupado por categoría de gasto
    const byCategory = Object.entries(
      expenseRows.reduce((acc: Record<string, number>, e: any) => {
        const key = e.category || 'Sin categoría';
        acc[key] = (acc[key] || 0) + Number(e.amount || 0);
        return acc;
      }, {})
    ).map(([category, amount]) => ({ category, amount }));

    // Balance general
    const receivable = invoices
      .filter((i) => i.status === 'Pendiente' || i.status === 'Vencida')
      .reduce((a, i) => a + Number(i.total || 0), 0);
    const payable = expenseRows
      .filter((e) => e.status === 'Pendiente')
      .reduce((a, e) => a + Number(e.amount || 0), 0);
    const fixedAssets = assets.reduce((a, x) => a + Number(x.book_value ?? x.purchase_cost ?? 0), 0);
    const cash = collected - expenseRows.filter((e) => e.status === 'Pagado').reduce((a, e) => a + Number(e.amount || 0), 0);
    const totalAssets = cash + receivable + fixedAssets;
    const totalLiabilities = payable;
    const equity = totalAssets - totalLiabilities;

    res.json({
      status: 'success',
      income_statement: {
        internet_income: collected,
        other_income: other,
        total_income: incomeTotal,
        expenses_total: expenseTotal,
        expenses_by_category: byCategory,
        net_profit: profit,
        margin_pct: incomeTotal > 0 ? Math.round((profit / incomeTotal) * 1000) / 10 : 0,
      },
      balance_sheet: {
        cash,
        accounts_receivable: receivable,
        fixed_assets: fixedAssets,
        total_assets: totalAssets,
        accounts_payable: payable,
        total_liabilities: totalLiabilities,
        equity,
      },
      meta: {
        payments_count: payments.length,
        expenses_count: expenseRows.length,
        invoices_count: invoices.length,
        assets_count: assets.length,
        bank_accounts_count: bankAccounts.length,
      },
    });
  });


  // Herramientas REALES sobre RouterOS (protocolo binario, puerto 8728/8729).
  // Abre un socket contra el equipo y devuelve la salida cruda del router.
  app.post('/api/v1/routers/:id/tool', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({
        status: 'error',
        message: `El router "${router.name}" no tiene IP de gestión configurada.`,
      });
    }
    const tool = String(req.body?.tool || 'ping');

    try {
      const result = await runRouterTool(routerCreds(router), tool, String(router.name || 'router'));
      appendAudit(
        db,
        1,
        'API',
        'ROUTER_TOOL',
        'Router',
        router.name,
        `Herramienta ${tool} ejecutada por API RouterOS sobre ${router.name} (${router.ip_address}).`
      );
      saveDb(db);
      return res.json({
        status: 'success',
        real: true,
        router: router.name,
        tool,
        command: result.command,
        rows: result.rows,
        output: result.text,
      });
    } catch (err: any) {
      appendAudit(
        db,
        1,
        'API',
        'ROUTER_TOOL_ERROR',
        'Router',
        router.name,
        `Fallo la herramienta ${tool} sobre ${router.name}: ${err?.message || err}`
      );
      saveDb(db);
      return res.status(502).json({
        status: 'error',
        real: true,
        router: router.name,
        tool,
        message: `No se pudo ejecutar "${tool}" en ${router.name} (${router.ip_address}): ${err?.message || err}`,
      });
    }
  });

  // Prueba de conexión REAL: autentica contra la API RouterOS y lee identidad/recursos.
  app.post('/api/v1/routers/:id/test', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({
        status: 'error',
        ok: false,
        message: `El router "${router.name}" no tiene IP de gestión configurada.`,
      });
    }

    const result = await testRouterConnection(routerCreds(router));
    appendAudit(
      db,
      1,
      'API',
      result.ok ? 'ROUTER_TEST_OK' : 'ROUTER_TEST_FAIL',
      'Router',
      router.name,
      `Prueba de conexión a ${router.name} (${router.ip_address}): ${result.message}`
    );
    saveDb(db);
    return res.status(result.ok ? 200 : 502).json({ status: result.ok ? 'success' : 'error', real: true, ...result });
  });

  // ============================================================================
  // TRAFFIC CONTROL API ENDPOINTS (Simple Queues, PCQ, Address Lists, FreeRADIUS)
  // ============================================================================

  // Simple Queues
  app.get('/api/v1/routers/:id/simple-queues', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const queues = driver.listSimpleQueues();
      return res.json({ status: 'success', real: true, router: router.name, queues });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.post('/api/v1/routers/:id/simple-queues', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const created = driver.createSimpleQueue(req.body || {});
      appendAudit(db, 1, 'API', 'CREATE', 'SimpleQueue', req.body?.name || '', `Simple Queue creada en ${router.name}`);
      saveDb(db);
      return res.status(201).json({ status: 'success', real: true, router: router.name, message: 'Simple Queue creada.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.put('/api/v1/routers/:id/simple-queues/:name', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      driver.updateSimpleQueue(req.params.name, req.body || {});
      appendAudit(db, 1, 'API', 'UPDATE', 'SimpleQueue', req.params.name, `Simple Queue actualizada en ${router.name}`);
      saveDb(db);
      return res.json({ status: 'success', real: true, router: router.name, message: 'Simple Queue actualizada.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.delete('/api/v1/routers/:id/simple-queues/:name', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      driver.removeSimpleQueue(req.params.name);
      appendAudit(db, 1, 'API', 'DELETE', 'SimpleQueue', req.params.name, `Simple Queue eliminada en ${router.name}`);
      saveDb(db);
      return res.json({ status: 'success', real: true, router: router.name, message: 'Simple Queue eliminada.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  // PCQ Profiles
  app.get('/api/v1/routers/:id/pcq-profiles', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const profiles = driver.listPcqProfiles();
      return res.json({ status: 'success', real: true, router: router.name, profiles });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  // Address Lists
  app.get('/api/v1/routers/:id/address-lists', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const lists = driver.listAddressLists();
      return res.json({ status: 'success', real: true, router: router.name, lists });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.post('/api/v1/routers/:id/address-lists/:list/entries', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      driver.addAddressListEntry(req.params.list, req.body?.address || '', req.body?.comment || '');
      appendAudit(db, 1, 'API', 'CREATE', 'AddressList', `${req.body?.address}@${req.params.list}`, `IP agregada a Address List en ${router.name}`);
      saveDb(db);
      return res.status(201).json({ status: 'success', real: true, router: router.name, message: 'Entrada agregada a Address List.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.delete('/api/v1/routers/:id/address-lists/:list/entries/:address', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      driver.removeAddressListEntry(req.params.list, req.params.address);
      appendAudit(db, 1, 'API', 'DELETE', 'AddressList', `${req.params.address}@${req.params.list}`, `IP removida de Address List en ${router.name}`);
      saveDb(db);
      return res.json({ status: 'success', real: true, router: router.name, message: 'Entrada removida de Address List.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  // Moroso Cut/Reactivación via Traffic Driver
  app.post('/api/v1/routers/:id/moroso-cut', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const result = driver.applyMorosoCut(req.body?.pppoe_user || '', req.body?.ip_address || '', req.body?.address_list || 'MOROSOS_ISP');
      appendAudit(db, 1, 'API', 'MOROSO_CUT', 'TrafficControl', req.body?.pppoe_user || '', `Corte moroso aplicado en ${router.name}: ${JSON.stringify(result)}`);
      saveDb(db);
      return res.json({ status: 'success', real: true, router: router.name, result });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  app.post('/api/v1/routers/:id/moroso-reactivate', async (req: Request, res: Response) => {
    const db = loadDb();
    const router = (db.routers || []).find((r: any) => String(r.id) === String(req.params.id));
    if (!router) return res.status(404).json({ status: 'error', message: 'Router no encontrado.' });
    if (!router.ip_address) {
      return res.status(400).json({ status: 'error', message: 'Router sin IP de gestión.' });
    }
    try {
      const driver = new MikrotikTrafficDriver(router);
      const result = driver.reactivateService(req.body?.pppoe_user || '', req.body?.ip_address || '', req.body?.address_list || 'MOROSOS_ISP', req.body?.active_profile || 'default');
      appendAudit(db, 1, 'API', 'MOROSO_REACTIVATE', 'TrafficControl', req.body?.pppoe_user || '', `Reactivación aplicada en ${router.name}: ${JSON.stringify(result)}`);
      saveDb(db);
      return res.json({ status: 'success', real: true, router: router.name, result });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, router: router.name, message: err?.message || err });
    }
  });

  // FreeRADIUS endpoints
  app.get('/api/v1/freeradius/active-sessions', async (_req: Request, res: Response) => {
    try {
      const driver = FreeRadiusProvider.make();
      const sessions = driver.getActiveSessions();
      return res.json({ status: 'success', real: true, sessions });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, message: err?.message || err });
    }
  });

  app.post('/api/v1/freeradius/disconnect', async (req: Request, res: Response) => {
    try {
      const driver = FreeRadiusProvider.make();
      driver.disconnectSession(req.body?.username || '', req.body?.nas_ip || '');
      return res.json({ status: 'success', real: true, message: 'Sesión desconectada vía CoA.' });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, message: err?.message || err });
    }
  });

  app.get('/api/v1/freeradius/stats', async (_req: Request, res: Response) => {
    try {
      const driver = FreeRadiusProvider.make();
      const stats = driver.getGlobalStats();
      return res.json({ status: 'success', real: true, stats });
    } catch (err: any) {
      return res.status(502).json({ status: 'error', real: true, message: err?.message || err });
    }
  });

  // Responder ticket
  app.post('/api/v1/data/tickets/:id/reply', (req: Request, res: Response) => {
    const db = loadDb();
    if (!Array.isArray(db.ticket_replies)) db.ticket_replies = [];
    const ticket = (db.tickets || []).find((t: any) => String(t.id) === String(req.params.id));
    if (!ticket) return res.status(404).json({ status: 'error', message: 'Ticket no encontrado.' });
    const id = nextId('ticket_replies', db.ticket_replies || []);
    const reply = {
      id,
      isp_id: 1,
      code: `REP-${String(id).padStart(4, '0')}`,
      ticket_code: ticket.code,
      author: String(req.body?.author || 'Staff'),
      message: String(req.body?.message || ''),
      internal: req.body?.internal ? 'Sí' : 'No',
      created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };
    db.ticket_replies.unshift(reply);
    if (ticket.status === 'Nuevo') ticket.status = 'En proceso';
    saveDb(db);
    return res.status(201).json({ status: 'success', message: 'Respuesta registrada en el ticket.', row: reply });
  });

  // Estadísticas de clientes (por zona y estado)
  app.get('/api/v1/customer-stats', (_req: Request, res: Response) => {
    const db = loadDb();
    const customers: any[] = db.customers || [];
    const zones: any[] = db.zones || [];
    const statuses = ['Activo', 'Moroso', 'Suspendido', 'Instalación pendiente', 'Cancelado'];
    res.json({
      status: 'success',
      total: customers.length,
      by_status: statuses.map((status) => ({ status, count: customers.filter((c) => c.status === status).length })),
      by_zone: zones.map((z) => ({
        zone: z.name,
        count: customers.filter((c) => c.sector === z.name || c.zone === z.name).length,
      })),
      by_sector: Object.entries(
        customers.reduce((acc: Record<string, number>, c: any) => {
          const key = c.sector || 'Sin sector';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      ).map(([sector, count]) => ({ sector, count })),
      by_month: Object.entries(
        customers.reduce((acc: Record<string, number>, c: any) => {
          const key = String(c.registered_at || '').slice(0, 7) || 'Sin fecha';
          acc[key] = (acc[key] || 0) + 1;
          return acc;
        }, {})
      )
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => String(a.month).localeCompare(String(b.month))),
    });
  });

  // Datos de la empresa (Mi empresa)
  app.put('/api/v1/isps/:id', (req: Request, res: Response) => {
    const db = loadDb();
    const isp = (db.isps || []).find((i: any) => String(i.id) === String(req.params.id));
    if (!isp) return res.status(404).json({ status: 'error', message: 'Empresa no encontrada.' });
    const allowed = [
      'name',
      'code',
      'domain',
      'portal_domain',
      'currency',
      'currency_symbol',
      'timezone',
      'plan_code',
      'cut_day',
      'grace_days',
      'auto_reactivate',
      'ocr_auto_approve',
    ];
    allowed.forEach((key) => {
      if (key in (req.body || {})) isp[key] = req.body[key];
    });
    appendAudit(db, 1, 'API', 'UPDATE', 'Mi empresa', String(isp.code || isp.id), `Datos de la empresa actualizados.`);
    saveDb(db);
    return res.json({ status: 'success', message: 'Datos de la empresa actualizados.', isp });
  });

  // Consolidado de métricas para el sidebar / dashboard
  app.get('/api/v1/metrics', (_req: Request, res: Response) => {
    const db = loadDb();
    const count = (key: string) => (Array.isArray(db[key]) ? db[key].length : 0);
    res.json({
      status: 'success',
      metrics: Object.fromEntries(MODULE_REGISTRY.map((mod) => [mod.key, count(mod.key)])),
    });
  });
}
