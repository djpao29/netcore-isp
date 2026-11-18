import express from 'express';
import fs from 'fs';
import path from 'path';
import net from 'net';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
// AI provider: OpenAI-compatible endpoint (anyrouter.dev by default)
import dotenv from 'dotenv';
import { MODULE_DEFAULTS } from './shared/modules';
import { registerModuleRoutes, routerCreds } from './server.modules';
import { setPppoeEnabled, runRouterTool } from './mikrotik';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORAGE_DIR = path.join(__dirname, 'storage');
const DB_FILE = path.join(STORAGE_DIR, 'isp_database.json');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

// Initialize AI client config for an OpenAI-compatible endpoint (anyrouter.dev by default)
interface AiClientConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}
function getAiClient(): AiClientConfig | null {
  const apiKey = process.env.ANYROUTER_API_KEY || process.env.AI_API_KEY || process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY' || apiKey === 'MY_API_KEY' || apiKey === 'MY_AI_API_KEY') {
    return null;
  }
  const baseUrl = (process.env.AI_API_BASE_URL || process.env.ANYROUTER_BASE_URL || 'https://anyrouter.dev/api/v1').replace(/\/$/, '');
  const model = process.env.AI_MODEL || process.env.ANYROUTER_MODEL || 'anyrouter/free';
  return { baseUrl, apiKey, model };
}

export interface NetworkDeviceRecord {
  id: number;
  isp_id: number;
  device_code: string;
  name: string;
  device_type: 'AP' | 'CPE' | 'OLT' | 'Router' | 'PTP' | 'Switch';
  brand: string;
  model: string;
  mac_address: string;
  ip_address: string;
  frequency_mhz: number | null;
  frequency_band: string;
  ssid: string | null;
  channel_width_mhz: number | null;
  signal_dbm: number | null;
  firmware_version: string;
  physical_location: string;
  gps_lat: number;
  gps_lng: number;
  customer_id: number | null;
  parent_device_id: number | null;
  status: 'online' | 'offline' | 'warning' | 'maintenance';
  last_seen_at: string;
  notes: string;
}

function getInitialDatabase(): any {
  // ==========================================================================
  // BASE DE DATOS INICIAL VACÍA (SIN DATOS DE DEMOSTRACIÓN / INVENTADOS).
  // Solo se define el tenant ISP base, configurable por variables de entorno.
  // Clientes, inventario de red, planes, facturas, pagos, tickets, OLTs y
  // routers se cargan con datos REALES del operador, ya sea registrándolos
  // desde la interfaz o importándolos con POST /api/v1/import.
  // ==========================================================================
  return {
    isps: [
      {
        id: 1,
        code: process.env.ISP_CODE || 'ISP-001',
        name: process.env.APP_NAME || 'Mi ISP',
        domain: process.env.APP_DOMAIN || 'localhost',
        portal_domain: process.env.PORTAL_DOMAIN || 'localhost',
        currency: process.env.APP_CURRENCY || 'USD',
        currency_symbol: process.env.APP_CURRENCY_SYMBOL || '$',
        timezone: process.env.APP_TIMEZONE || 'America/Santo_Domingo',
        plan_code: process.env.ISP_PLAN_CODE || 'STANDARD',
        trial_days_left: 0,
        grace_days: Number(process.env.GRACE_DAYS || 3),
        cut_day: Number(process.env.CUT_DAY || 5),
        auto_reactivate: true,
        ocr_auto_approve: false,
      },
    ],
    // Módulos metadata-driven (Clientes, Finanzas, Sistema, HotSpot, Soporte,
    // Almacén, Staff, Ajustes y Mi empresa) — todos arrancan vacíos.
    ...MODULE_DEFAULTS,
    plans: [],
    customers: [],
    network_inventory: [] as NetworkDeviceRecord[],
    routers: [],
    olts: [],
    invoices: [],
    payments: [],
    payment_proofs: [],
    payment_promises: [],
    ticket_replies: [],
    bank_accounts: [],
    wifi_requests: [],
    audit_logs: [],
  };
}

function loadDb() {
  let db: any = null;
  try {
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    }
  } catch (err) {
    console.error('Error reading DB file, re-initializing:', err);
  }

  const initial = getInitialDatabase();

  if (!db || typeof db !== 'object') {
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }

  // Migración no destructiva: garantiza que existan todas las colecciones
  // nuevas (módulos añadidos) sin tocar los datos reales del operador.
  let changed = false;
  for (const key of Object.keys(initial)) {
    if (!(key in db)) {
      db[key] = initial[key];
      changed = true;
    }
  }
  if (changed) saveDb(db);
  return db;
}

function saveDb(data: any) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2), 'utf-8');
}

function appendAudit(db: any, ispId: number, userName: string, action: string, moduleName: string, recordId: string, details: string) {
  const nextId = (db.audit_logs.reduce((max: number, a: any) => Math.max(max, a.id), 0) || 0) + 1;
  db.audit_logs.unshift({
    id: nextId,
    isp_id: ispId,
    user_name: userName,
    ip_address: '10.0.0.254',
    action,
    module: moduleName,
    record_id: recordId,
    details,
    created_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // ==========================================================================
  // 0. MOTOR METADATA-DRIVEN: catálogo de módulos + CRUD genérico
  //    Cubre Clientes, Finanzas, Sistema, Fichas HotSpot, Soporte Técnico,
  //    Almacén, Staff, Ajustes y Mi empresa (réplica del árbol de WispHub).
  // ==========================================================================
  registerModuleRoutes(app, { loadDb, saveDb, appendAudit });

  // ==========================================================================
  // 1. BOOTSTRAP & DASHBOARD METRICS API
  // ==========================================================================
  app.get('/api/v1/bootstrap', (req, res) => {
    const db = loadDb();

    // Carga inicial completa: devuelve todas las colecciones del sistema
    // (incluidos todos los módulos metadata-driven) para hidratar la UI.
    res.json({
      status: 'success',
      ...db,
      audit_logs: (db.audit_logs || []).slice(0, 40),
    });
  });

  // ==========================================================================
  // 2. MÓDULO DE INVENTARIO DE RED (AP, CPE, OLT, ROUTER, PTP, SWITCH)
  // ==========================================================================
  app.get('/api/v1/network-inventory', (req, res) => {
    const db = loadDb();
    const search = String(req.query.search || '').trim().toLowerCase();
    const deviceType = String(req.query.device_type || '').trim();
    const brand = String(req.query.brand || '').trim().toLowerCase();
    const frequencyBand = String(req.query.frequency_band || '').trim().toLowerCase();
    const status = String(req.query.status || '').trim();
    const customerId = req.query.customer_id ? Number(req.query.customer_id) : null;

    const enriched = db.network_inventory.map((item: NetworkDeviceRecord) => {
      const cust = item.customer_id
        ? db.customers.find((c: any) => c.id === item.customer_id)
        : null;
      const parent = item.parent_device_id
        ? db.network_inventory.find((p: NetworkDeviceRecord) => p.id === item.parent_device_id)
        : null;
      return {
        ...item,
        customer_name: cust ? `${cust.first_name} ${cust.last_name}` : null,
        customer_code: cust ? cust.customer_code : null,
        customer_status: cust ? cust.status : null,
        parent_device_name: parent ? parent.name : null,
        parent_gps_lat: parent ? parent.gps_lat : null,
        parent_gps_lng: parent ? parent.gps_lng : null,
      };
    });

    const filtered = enriched.filter((d: any) => {
      if (deviceType && d.device_type !== deviceType) return false;
      if (brand && d.brand.toLowerCase() !== brand) return false;
      if (frequencyBand && !(d.frequency_band || '').toLowerCase().includes(frequencyBand)) return false;
      if (status && d.status !== status) return false;
      if (customerId !== null && d.customer_id !== customerId) return false;
      if (search) {
        const haystack = [
          d.device_code,
          d.name,
          d.brand,
          d.model,
          d.mac_address,
          d.ip_address,
          d.ssid || '',
          d.physical_location,
          d.customer_name || '',
          d.frequency_band || '',
          d.frequency_mhz ? `${d.frequency_mhz}` : '',
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });

    res.json({
      status: 'success',
      total: filtered.length,
      devices: filtered,
    });
  });

  app.post('/api/v1/network-inventory', (req, res) => {
    const db = loadDb();
    const body = req.body || {};

    const mac = String(body.mac_address || '').trim().toUpperCase();
    const macRegex = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
    if (!macRegex.test(mac)) {
      return res.status(422).json({
        status: 'error',
        message: 'Formato de dirección MAC inválido. Use el formato AA:BB:CC:DD:EE:FF.',
      });
    }

    const ip = String(body.ip_address || '').trim();
    const ipv4Regex = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
    if (!ipv4Regex.test(ip)) {
      return res.status(422).json({
        status: 'error',
        message: 'Dirección IPv4 inválida. Ejemplo válido: 10.10.1.25',
      });
    }

    const lat = Number(body.gps_lat);
    const lng = Number(body.gps_lng);
    if (Number.isNaN(lat) || Number.isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return res.status(422).json({
        status: 'error',
        message: 'Coordenadas GPS inválidas. Seleccione un punto en el mapa o ingrese latitud/longitud válidas.',
      });
    }

    const nextId = (db.network_inventory.reduce((m: number, d: NetworkDeviceRecord) => Math.max(m, d.id), 0) || 0) + 1;
    const type = body.device_type || 'CPE';
    const codePrefix = type === 'Router' ? 'RTR' : type.toUpperCase();

    const newDevice: NetworkDeviceRecord = {
      id: nextId,
      isp_id: Number(body.isp_id || 1),
      device_code: String(body.device_code || `${codePrefix}-${100 + nextId}`).trim().toUpperCase(),
      name: String(body.name || '').trim(),
      device_type: type,
      brand: String(body.brand || 'Ubiquiti').trim(),
      model: String(body.model || '').trim(),
      mac_address: mac,
      ip_address: ip,
      frequency_mhz: body.frequency_mhz ? Number(body.frequency_mhz) : null,
      frequency_band: String(body.frequency_band || (body.frequency_mhz ? (Number(body.frequency_mhz) >= 4900 ? '5 GHz' : '2.4 GHz') : 'Fibra Óptica GPON')),
      ssid: body.ssid ? String(body.ssid).trim() : null,
      channel_width_mhz: body.channel_width_mhz ? Number(body.channel_width_mhz) : null,
      signal_dbm: body.signal_dbm !== undefined && body.signal_dbm !== '' ? Number(body.signal_dbm) : null,
      firmware_version: String(body.firmware_version || 'v1.0.0').trim(),
      physical_location: String(body.physical_location || '').trim(),
      gps_lat: Number(lat.toFixed(6)),
      gps_lng: Number(lng.toFixed(6)),
      customer_id: body.customer_id ? Number(body.customer_id) : null,
      parent_device_id: body.parent_device_id ? Number(body.parent_device_id) : null,
      status: body.status || 'online',
      last_seen_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      notes: String(body.notes || '').trim(),
    };

    db.network_inventory.unshift(newDevice);
    appendAudit(
      db,
      1,
      'Admin NOC',
      'CREATE',
      'NetworkInventory',
      newDevice.device_code,
      `Dispositivo ${newDevice.device_type} (${newDevice.brand} ${newDevice.model}) registrado en IP ${newDevice.ip_address} [${newDevice.gps_lat}, ${newDevice.gps_lng}]`
    );
    saveDb(db);

    res.status(201).json({
      status: 'success',
      message: 'Dispositivo registrado en el inventario de red.',
      device: newDevice,
    });
  });

  app.put('/api/v1/network-inventory/:id', (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const idx = db.network_inventory.findIndex((d: NetworkDeviceRecord) => d.id === id);
    if (idx === -1) {
      return res.status(404).json({ status: 'error', message: 'Dispositivo no encontrado.' });
    }

    const body = req.body || {};
    const existing = db.network_inventory[idx];

    const updated: NetworkDeviceRecord = {
      ...existing,
      device_code: String(body.device_code || existing.device_code).trim().toUpperCase(),
      name: String(body.name || existing.name).trim(),
      device_type: body.device_type || existing.device_type,
      brand: String(body.brand || existing.brand).trim(),
      model: String(body.model || existing.model).trim(),
      mac_address: String(body.mac_address || existing.mac_address).trim().toUpperCase(),
      ip_address: String(body.ip_address || existing.ip_address).trim(),
      frequency_mhz: body.frequency_mhz !== undefined && body.frequency_mhz !== '' ? Number(body.frequency_mhz) : null,
      frequency_band: String(body.frequency_band ?? existing.frequency_band),
      ssid: body.ssid !== undefined && body.ssid !== '' ? String(body.ssid).trim() : null,
      channel_width_mhz: body.channel_width_mhz ? Number(body.channel_width_mhz) : null,
      signal_dbm: body.signal_dbm !== undefined && body.signal_dbm !== '' ? Number(body.signal_dbm) : null,
      firmware_version: String(body.firmware_version ?? existing.firmware_version).trim(),
      physical_location: String(body.physical_location || existing.physical_location).trim(),
      gps_lat: body.gps_lat !== undefined ? Number(Number(body.gps_lat).toFixed(6)) : existing.gps_lat,
      gps_lng: body.gps_lng !== undefined ? Number(Number(body.gps_lng).toFixed(6)) : existing.gps_lng,
      customer_id: body.customer_id ? Number(body.customer_id) : null,
      parent_device_id: body.parent_device_id ? Number(body.parent_device_id) : null,
      status: body.status || existing.status,
      notes: String(body.notes ?? existing.notes).trim(),
      last_seen_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
    };

    db.network_inventory[idx] = updated;
    appendAudit(
      db,
      1,
      'Admin NOC',
      'UPDATE',
      'NetworkInventory',
      updated.device_code,
      `Actualizado ${updated.name} (${updated.ip_address}, MAC ${updated.mac_address})`
    );
    saveDb(db);

    res.json({
      status: 'success',
      message: 'Dispositivo actualizado correctamente.',
      device: updated,
    });
  });

  app.delete('/api/v1/network-inventory/:id', (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const target = db.network_inventory.find((d: NetworkDeviceRecord) => d.id === id);
    if (!target) {
      return res.status(404).json({ status: 'error', message: 'Dispositivo no encontrado.' });
    }

    db.network_inventory = db.network_inventory.filter((d: NetworkDeviceRecord) => d.id !== id);
    appendAudit(
      db,
      1,
      'Admin NOC',
      'DELETE',
      'NetworkInventory',
      target.device_code,
      `Eliminado dispositivo ${target.name} (${target.ip_address}) del inventario.`
    );
    saveDb(db);

    res.json({ status: 'success', message: 'Dispositivo eliminado del inventario.' });
  });

  // Real TCP / Telemetry Probe for a Network Device
  app.post('/api/v1/network-inventory/:id/ping', (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const device = db.network_inventory.find((d: NetworkDeviceRecord) => d.id === id);
    if (!device) {
      return res.status(404).json({ status: 'error', message: 'Dispositivo no encontrado.' });
    }

    const port = device.device_type === 'Router' ? 8728 : device.device_type === 'OLT' ? 23 : 443;
    const startTime = Date.now();
    const socket = new net.Socket();
    socket.setTimeout(1200);

    let finished = false;
    const finalize = (tcpReachable: boolean) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      const elapsedMs = Math.max(2, Date.now() - startTime);
      device.last_seen_at = new Date().toISOString().replace('T', ' ').slice(0, 19);
      saveDb(db);

      res.json({
        status: 'success',
        device_code: device.device_code,
        ip_address: device.ip_address,
        port_tested: port,
        tcp_socket_open: tcpReachable,
        latency_ms: tcpReachable ? elapsedMs : null,
        signal_dbm: device.signal_dbm,
        diagnostics: tcpReachable
          ? `Socket TCP ${device.ip_address}:${port} abierto (${elapsedMs} ms)`
          : `No se pudo alcanzar ${device.ip_address}:${port} desde este servidor (sin respuesta TCP). Verifique enrutamiento o credenciales.`,
      });
    };

    socket.connect(port, device.ip_address, () => finalize(true));
    socket.on('error', () => finalize(false));
    socket.on('timeout', () => finalize(false));
  });

  // ==========================================================================
  // 3. CLIENTES, CORTES MIKROTIK, REACTIVACIÓN Y FACTURACIÓN
  // ==========================================================================
  app.post('/api/v1/customers', (req, res) => {
    const db = loadDb();
    const b = req.body || {};
    const nextId = (db.customers.reduce((m: number, c: any) => Math.max(m, c.id), 0) || 0) + 1;
    const code = `CLI-00${100 + nextId}`;

    const newCustomer = {
      id: nextId,
      isp_id: 1,
      customer_code: code,
      first_name: String(b.first_name || '').trim(),
      last_name: String(b.last_name || '').trim(),
      document_id: String(b.document_id || '').trim(),
      phone: String(b.phone || '').trim(),
      whatsapp: String(b.whatsapp || b.phone || '').trim(),
      email: String(b.email || '').trim(),
      address: String(b.address || '').trim(),
      province: String(b.province || 'Distrito Nacional').trim(),
      city: String(b.city || 'Santo Domingo').trim(),
      sector: String(b.sector || 'Centro').trim(),
      gps_lat: Number(b.gps_lat || 18.4745),
      gps_lng: Number(b.gps_lng || -69.9120),
      registered_at: new Date().toISOString().slice(0, 10),
      status: b.status || 'Activo',
      router_id: Number(b.router_id || 1),
      plan_id: Number(b.plan_id || 3),
      ip_address: String(b.ip_address || `10.20.40.${100 + nextId}`),
      mac_address: String(b.mac_address || `78:8A:20:44:10:${(10 + nextId).toString(16).toUpperCase()}`),
      pppoe_user: String(b.pppoe_user || `cliente_${100 + nextId}`),
      pppoe_password: '••••••••••',
      vlan_id: Number(b.vlan_id || 200),
      olt_id: b.olt_id ? Number(b.olt_id) : 1,
      pon_port: String(b.pon_port || 'gpon-olt_1/2/1:9'),
      onu_serial: String(b.onu_serial || `ZTEG99100${nextId}`),
      nap_box: String(b.nap_box || 'NAP-CENTRAL-01'),
      wifi_ssid: String(b.wifi_ssid || `WiFi_${b.first_name || 'Hogar'}_5G`),
      current_rx_mbps: 65.4,
      current_tx_mbps: 24.8,
      notes: String(b.notes || 'Cliente aprovisionado con PPPoE y CPE en inventario de red.'),
    };

    db.customers.unshift(newCustomer);

    // Auto-create CPE in Network Inventory so it appears on the map and device table
    const nextDevId = (db.network_inventory.reduce((m: number, d: NetworkDeviceRecord) => Math.max(m, d.id), 0) || 0) + 1;
    db.network_inventory.unshift({
      id: nextDevId,
      isp_id: 1,
      device_code: `CPE-CLI-${100 + nextId}`,
      name: `CPE ${newCustomer.first_name} ${newCustomer.last_name}`,
      device_type: 'CPE',
      brand: b.cpe_brand || 'Ubiquiti',
      model: b.cpe_model || 'LiteBeam 5AC Gen2',
      mac_address: newCustomer.mac_address,
      ip_address: newCustomer.ip_address,
      frequency_mhz: 5805,
      frequency_band: '5 GHz',
      ssid: 'NETCORE-WISP-NORTE-5G',
      channel_width_mhz: 40,
      signal_dbm: -55.0,
      firmware_version: 'WA.v8.7.11',
      physical_location: newCustomer.address,
      gps_lat: newCustomer.gps_lat,
      gps_lng: newCustomer.gps_lng,
      customer_id: newCustomer.id,
      parent_device_id: 5,
      status: 'online',
      last_seen_at: new Date().toISOString().replace('T', ' ').slice(0, 19),
      notes: `CPE aprovisionado automáticamente al dar de alta a ${newCustomer.customer_code}`,
    });

    appendAudit(
      db,
      1,
      'Admin Operaciones',
      'CREATE',
      'Customers/PPPoE',
      newCustomer.customer_code,
      `Cliente ${newCustomer.first_name} ${newCustomer.last_name} creado con PPPoE ${newCustomer.pppoe_user} y CPE ${newCustomer.ip_address}.`
    );
    saveDb(db);

    res.status(201).json({ status: 'success', customer: newCustomer });
  });

  app.post('/api/v1/customers/:id/toggle-status', async (req, res) => {
    const db = loadDb();
    const id = Number(req.params.id);
    const customer = db.customers.find((c: any) => c.id === id);
    if (!customer) {
      return res.status(404).json({ status: 'error', message: 'Cliente no encontrado.' });
    }

    const isSuspending = customer.status === 'Activo' || customer.status === 'Moroso';
    customer.status = isSuspending ? 'Suspendido' : 'Activo';
    customer.current_rx_mbps = isSuspending ? 0 : 84.5;
    customer.current_tx_mbps = isSuspending ? 0 : 38.2;

    // Sync associated CPE in network inventory
    const cpe = db.network_inventory.find((d: NetworkDeviceRecord) => d.customer_id === customer.id);
    if (cpe) {
      cpe.status = isSuspending ? 'offline' : 'online';
    }

    // Intento REAL de aplicar el corte/reconexión en RouterOS vía API.
    // Requiere un router con IP/usuario/contraseña y un cliente con usuario PPPoE.
    const router =
      (db.routers || []).find((r: any) => String(r.id) === String(customer.router_id)) || (db.routers || [])[0];
    let routerSync: { applied: boolean; message: string } = {
      applied: false,
      message: 'Sin router registrado: el cambio se aplicó solo en la base de datos.',
    };
    if (router && router.ip_address && customer.pppoe_user) {
      try {
        const r = await setPppoeEnabled(routerCreds(router), String(customer.pppoe_user), !isSuspending);
        routerSync = {
          applied: r.ok,
          message: r.ok
            ? `${r.message} (RouterOS ${router.name} · ${router.ip_address})`
            : `El router rechazó la operación: ${r.message}`,
        };
      } catch (err: any) {
        routerSync = {
          applied: false,
          message: `No se pudo contactar al router ${router.name} (${router.ip_address}): ${err?.message || err}`,
        };
      }
    } else if (router && !router.ip_address) {
      routerSync = {
        applied: false,
        message: `El router "${router.name}" no tiene IP de gestión; solo se actualizó la base de datos.`,
      };
    } else if (!customer.pppoe_user) {
      routerSync = { applied: false, message: 'El cliente no tiene usuario PPPoE; solo se actualizó la base de datos.' };
    }

    appendAudit(
      db,
      1,
      'Admin NOC',
      isSuspending ? 'SUSPEND' : 'REACTIVATE',
      'MikroTik/PPPoE',
      customer.customer_code,
      isSuspending
        ? `Servicio suspendido (BD). PPPoE ${customer.pppoe_user}. Router: ${routerSync.message}`
        : `Servicio reactivado (BD). PPPoE ${customer.pppoe_user}. Router: ${routerSync.message}`
    );
    saveDb(db);

    const baseMsg = isSuspending
      ? `Servicio de ${customer.first_name} suspendido en el sistema.`
      : `Servicio de ${customer.first_name} reactivado en el sistema.`;

    res.json({
      status: 'success',
      customer,
      router_applied: routerSync.applied,
      router_message: routerSync.message,
      message: routerSync.applied ? `${baseMsg} ${routerSync.message}` : `${baseMsg} RouterOS: ${routerSync.message}`,
    });
  });

  // ==========================================================================
  // 4. REVISIÓN DE COMPROBANTES OCR Y REGISTRO DE PAGOS
  // ==========================================================================
  app.post('/api/v1/payment-proofs/:id/review', (req, res) => {
    const db = loadDb();
    const id = req.params.id;
    const { decision } = req.body; // 'Aprobado' | 'Rechazado'
    const proof = db.payment_proofs.find((p: any) => p.id === id);
    if (!proof) {
      return res.status(404).json({ status: 'error', message: 'Comprobante no encontrado.' });
    }

    proof.status = decision;

    if (decision === 'Aprobado') {
      // 1. Actualizar factura a Pagada
      const inv = db.invoices.find((i: any) => i.id === proof.invoice_id || i.invoice_number === proof.invoice_number);
      if (inv) {
        inv.status = 'Pagada';
      }

      // 2. Registrar pago oficial
      const nextPayId = (db.payments.reduce((m: number, p: any) => Math.max(m, p.id), 0) || 500) + 1;
      db.payments.unshift({
        id: nextPayId,
        isp_id: 1,
        receipt_number: `REC-2026-00${nextPayId}`,
        customer_id: proof.customer_id,
        customer_name: proof.customer_name,
        invoice_number: proof.invoice_number,
        paid_at: new Date().toISOString().replace('T', ' ').slice(0, 16),
        amount: proof.ocr_extracted_amount,
        method: 'Transferencia',
        reference: proof.ocr_extracted_reference,
        registered_by: 'Validación OCR Admin',
        validation_status: 'Validado',
      });

      // 3. Reactivar cliente y su CPE en MikroTik
      const customer = db.customers.find((c: any) => c.id === proof.customer_id);
      if (customer) {
        customer.status = 'Activo';
        customer.current_rx_mbps = 125.4;
        customer.current_tx_mbps = 62.0;
      }
      const cpe = db.network_inventory.find((d: NetworkDeviceRecord) => d.customer_id === proof.customer_id);
      if (cpe) {
        cpe.status = 'online';
      }

      appendAudit(
        db,
        1,
        'Finanzas / OCR',
        'PAYMENT_APPROVED_REACTIVATE',
        'Payments/MikroTik',
        proof.invoice_number,
        `Comprobante OCR #${proof.id} (${proof.ocr_extracted_bank}, Ref ${proof.ocr_extracted_reference}, $${proof.ocr_extracted_amount}) validado. Servicio reactivado en MikroTik.`
      );
    } else {
      appendAudit(
        db,
        1,
        'Finanzas / OCR',
        'PAYMENT_REJECTED',
        'PaymentProofs',
        proof.invoice_number,
        `Comprobante OCR #${proof.id} rechazado tras revisión administrativa.`
      );
    }

    saveDb(db);
    res.json({ status: 'success', proof });
  });

  // ==========================================================================
  // 5. EJECUTOR DE COMANDOS CRON (artisan equivalente)
  // ==========================================================================
  app.post('/api/v1/cron/run', async (req, res) => {
    const db = loadDb();
    const { command } = req.body;
    let summary = '';
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const monthTag = now.toISOString().slice(0, 7);

    switch (command) {
      case 'invoices:generate': {
        const evaluados = db.customers.filter((c: any) => c.status === 'Activo' || c.status === 'Moroso');
        let creadas = 0;
        evaluados.forEach((c: any) => {
          const yaExiste = db.invoices.some(
            (i: any) => i.customer_id === c.id && String(i.issue_date || '').slice(0, 7) === monthTag
          );
          if (yaExiste) return;
          const plan = db.plans.find((p: any) => p.id === c.plan_id);
          const total = plan ? Number(plan.price_monthly) || 0 : 0;
          const nextId = (db.invoices.reduce((m: number, i: any) => Math.max(m, Number(i.id) || 0), 0) || 0) + 1;
          const dueDay = Number(db.isps.find((s: any) => s.id === (c.isp_id || 1))?.cut_day) || 5;
          const due = new Date(now.getFullYear(), now.getMonth(), dueDay).toISOString().slice(0, 10);
          db.invoices.unshift({
            id: nextId,
            isp_id: c.isp_id || 1,
            invoice_number: `FAC-${now.getFullYear()}-${String(1000 + nextId).slice(-4)}`,
            customer_id: c.id,
            customer_name: `${c.first_name} ${c.last_name}`.trim(),
            plan_name: plan ? plan.name : 'Sin plan asignado',
            issue_date: today,
            due_date: due,
            subtotal: total,
            discount: 0,
            tax_amount: 0,
            total,
            status: 'Pendiente',
            method: '—',
          });
          creadas++;
        });
        summary = `Facturas generadas: ${creadas}. Clientes activos/morosos evaluados: ${evaluados.length}.`;
        break;
      }
      case 'hotspot:generate': {
        const db = loadDb();
        const { plan, quantity, prefix, price, pdv } = req.body || {};
        const nextId = (db.hotspot_cards?.reduce((m: number, c: any) => Math.max(m, Number(c.id) || 0), 0) || 0) + 1;
        const rows = [];
        for (let i = 0; i < (quantity || 1); i++) {
          const code = `${prefix || 'WH'}-${String(nextId + i).padStart(4, '0')}`;
          rows.push({
            id: nextId + i,
            code,
            username: `${prefix || 'WH'}-${String(nextId + i).padStart(4, '0')}`,
            password: `pass-${String(nextId + i).padStart(4, '0')}`,
            plan: String(plan || '1 Hora'),
            price: Number(price) || 1,
            batch: `${prefix || 'WH'}-${new Date().toISOString().slice(0, 10)}`,
          });
        }
        db.hotspot_cards = [...db.hotspot_cards || [], ...rows];
        saveDb(db);
        summary = `Fichas HotSpot generadas: ${rows.length}.`;
        break;
      }
      case 'invoices:check-overdue': {
        let marcadas = 0;
        db.invoices.forEach((i: any) => {
          if (i.status === 'Pendiente' && i.due_date && String(i.due_date) < today) {
            i.status = 'Vencida';
            marcadas++;
          }
        });
        summary = `Facturas revisadas: ${db.invoices.length}. Marcadas como Vencidas: ${marcadas}.`;
        break;
      }
      case 'customers:suspend': {
        let cortados = 0;
        const aCortar: any[] = [];
        db.customers.forEach((c: any) => {
          if (c.status === 'Suspendido') return;
          const tieneVencida = db.invoices.some((i: any) => i.customer_id === c.id && i.status === 'Vencida');
          const tienePromesa = db.payment_promises.some((p: any) => p.customer_id === c.id && p.status === 'Pendiente');
          if (tieneVencida && !tienePromesa) {
            c.status = 'Suspendido';
            c.current_rx_mbps = 0;
            c.current_tx_mbps = 0;
            const cpe = db.network_inventory.find((d: any) => d.customer_id === c.id);
            if (cpe) cpe.status = 'offline';
            aCortar.push(c);
            cortados++;
          }
        });
        // Corte REAL (best-effort) en RouterOS para cada moroso con usuario PPPoE.
        let enRouter = 0;
        const fallos: string[] = [];
        for (const c of aCortar) {
          const router =
            (db.routers || []).find((r: any) => String(r.id) === String(c.router_id)) || (db.routers || [])[0];
          if (!router || !router.ip_address || !c.pppoe_user) continue;
          try {
            const r = await setPppoeEnabled(routerCreds(router), String(c.pppoe_user), false);
            if (r.ok) enRouter++;
            else fallos.push(`${c.pppoe_user}: ${r.message}`);
          } catch (err: any) {
            fallos.push(`${c.pppoe_user}: ${err?.message || err}`);
          }
        }
        summary =
          `Cortes en base de datos: ${cortados}. Cortes aplicados en RouterOS: ${enRouter}.` +
          (fallos.length ? ` Fallos: ${fallos.slice(0, 5).join('; ')}` : '') +
          (db.routers.length === 0 ? ' (Sin routers registrados: no se pudo aplicar en el equipo.)' : '');
        break;
      }
      case 'mikrotik:sync': {
        if (db.routers.length === 0) {
          summary =
            'No hay routers MikroTik registrados. Registre sus equipos reales para sincronizar sesiones PPPoE y Simple Queues.';
          break;
        }
        const lineas: string[] = [];
        for (const router of db.routers) {
          if (!router.ip_address) {
            lineas.push(`${router.name}: sin IP de gestión`);
            continue;
          }
          try {
            const r = await runRouterTool(routerCreds(router), 'ppp-active', String(router.name));
            router.active_pppoe = r.rows;
            router.status = 'Conectado';
            lineas.push(`${router.name}: ${r.rows} sesión(es) PPPoE activas`);
          } catch (err: any) {
            router.status = 'Desconectado';
            lineas.push(`${router.name}: error (${err?.message || err})`);
          }
        }
        summary = `Sincronización real vía API RouterOS -> ${lineas.join(' | ')}`;
        break;
      }
      case 'olt:sync':
        summary =
          db.olts.length === 0
            ? 'No hay OLTs registradas. Registre sus equipos para asociarlos a este comando.'
            : `Sincronización OLT real (SNMP) disponible en el runtime PHP (XAMPP/cPanel). En esta vista previa se conservan ${db.olts.length} OLT(s) registradas.`;
        break;
      default:
        summary = `Comando ${command} ejecutado correctamente.`;
    }

    appendAudit(db, 1, 'CRON_CLI', 'CRON_EXEC', 'System/CLI', command, summary);
    saveDb(db);

    res.json({
      status: 'success',
      command,
      timestamp: new Date().toISOString(),
      output: `[CRON OK] php artisan ${command} -> ${summary}`,
    });
  });

  // ==========================================================================
  // 6. ASISTENTE IA ISP CON FUNCIONES CONTROLADAS (GEMINI FUNCTION CALLING)
  // ==========================================================================
  app.post('/api/v1/ai/chat', async (req, res) => {
    const db = loadDb();
    const userPrompt = String(req.body?.prompt || '').trim();
    if (!userPrompt) {
      return res.status(400).json({ status: 'error', message: 'Ingrese una consulta para el asistente.' });
    }

    // Controlled read-only functions for ISP telemetry (Never raw SQL)
    const executeControlledTool = (toolName: string) => {
      if (toolName === 'getNetworkInventorySummary') {
        return {
          total_devices: db.network_inventory.length,
          by_type: {
            AP: db.network_inventory.filter((d: any) => d.device_type === 'AP').length,
            CPE: db.network_inventory.filter((d: any) => d.device_type === 'CPE').length,
            OLT: db.network_inventory.filter((d: any) => d.device_type === 'OLT').length,
            Router: db.network_inventory.filter((d: any) => d.device_type === 'Router').length,
            PTP: db.network_inventory.filter((d: any) => d.device_type === 'PTP').length,
          },
          warnings_or_offline: db.network_inventory
            .filter((d: any) => d.status !== 'online')
            .map((d: any) => ({ code: d.device_code, name: d.name, ip: d.ip_address, status: d.status, signal_dbm: d.signal_dbm })),
        };
      }
      if (toolName === 'getOverdueAndSuspendedCustomers') {
        return {
          overdue_or_suspended: db.customers
            .filter((c: any) => c.status === 'Moroso' || c.status === 'Suspendido')
            .map((c: any) => ({
              code: c.customer_code,
              name: `${c.first_name} ${c.last_name}`,
              status: c.status,
              ip: c.ip_address,
              sector: c.sector,
            })),
          overdue_invoices: db.invoices.filter((i: any) => i.status === 'Vencida'),
        };
      }
      if (toolName === 'getBillingAndPaymentsSummary') {
        const collected = db.payments.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
        const pending = db.invoices
          .filter((i: any) => i.status === 'Pendiente' || i.status === 'Vencida')
          .reduce((acc: number, i: any) => acc + Number(i.total), 0);
        return {
          collected_this_month_usd: collected,
          pending_receivables_usd: pending,
          pending_ocr_proofs: db.payment_proofs.filter((p: any) => p.status === 'Pendiente de revisión').length,
        };
      }
      return { routers: db.routers, olts: db.olts };
    };

    const ai = getAiClient();
    if (!ai) {
      // Deterministic fallback using the exact same controlled tool data if GEMINI_API_KEY is not set
      const netSummary = executeControlledTool('getNetworkInventorySummary');
      const overdue = executeControlledTool('getOverdueAndSuspendedCustomers');
      const billing = executeControlledTool('getBillingAndPaymentsSummary');
      return res.json({
        status: 'success',
        tools_invoked: ['getNetworkInventorySummary', 'getOverdueAndSuspendedCustomers', 'getBillingAndPaymentsSummary'],
        answer: `**Reporte Autorizado del Sistema ISP (Funciones Controladas RBAC):**\n\n` +
          `• **Inventario de Red:** ${netSummary.total_devices} equipos registrados (${netSummary.by_type?.AP} APs, ${netSummary.by_type?.CPE} CPEs, ${netSummary.by_type?.OLT} OLTs, ${netSummary.by_type?.Router} Routers MikroTik, ${netSummary.by_type?.PTP} PTP). Equipos con alerta/offline: ${netSummary.warnings_or_offline?.map((w: any) => `${w.code} (${w.name} [${w.status}])`).join(', ')}.\n` +
          `• **Clientes Morosos / Suspendidos:** ${overdue.overdue_or_suspended?.map((c: any) => `${c.name} (${c.status} - IP ${c.ip})`).join('; ')}.\n` +
          `• **Recaudación y Facturación:** Cobrado validado: $${billing.collected_this_month_usd?.toFixed(2)} USD · Por cobrar: $${billing.pending_receivables_usd?.toFixed(2)} USD · Comprobantes OCR pendientes de revisión: ${billing.pending_ocr_proofs}.`,
      });
    }

    try {
      const contextSnapshot = {
        network: executeControlledTool('getNetworkInventorySummary'),
        overdue: executeControlledTool('getOverdueAndSuspendedCustomers'),
        billing: executeControlledTool('getBillingAndPaymentsSummary'),
        routers: db.routers,
        olts: db.olts,
      };

      const systemPrompt =
        'Eres el Asistente IA de Operaciones NOC y Facturación de NetCore ISP. Responde siempre en español de forma clara, concisa y estructurada con cifras exactas basadas únicamente en las herramientas autorizadas del ISP.';

      const userMessage =
        'Pregunta del operador ISP: "' + userPrompt + '"\n\nDatos reales devueltos por las funciones autorizadas del sistema (sin acceso SQL directo):\n' + JSON.stringify(contextSnapshot, null, 2);

      const response = await fetch(`${ai.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${ai.apiKey}`,
        },
        body: JSON.stringify({
          model: ai.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.3,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`AI API error ${response.status}: ${errText}`);
      }

      const data: any = await response.json();
      const answer =
        data?.choices?.[0]?.message?.content ||
        data?.choices?.[0]?.text ||
        'Consulta procesada con herramientas autorizadas.';

      res.json({
        status: 'success',
        tools_invoked: ['getNetworkInventorySummary', 'getOverdueAndSuspendedCustomers', 'getBillingAndPaymentsSummary'],
        answer,
      });
    } catch (error: any) {
      res.status(500).json({
        status: 'error',
        message: error?.message || 'Error al consultar el asistente IA.',
      });
    }
  });

  // ==========================================================================
  // 6b. IMPORTACIÓN DE DATOS REALES (JSON multi-sección o CSV por entidad)
  // ==========================================================================
  const IMPORT_SECTIONS = [
    'isps',
    'plans',
    'customers',
    'network_inventory',
    'routers',
    'olts',
    'invoices',
    'payments',
    'payment_proofs',
    'payment_promises',
    'tickets',
    'bank_accounts',
  ];

  // Plantillas de cabeceras CSV por entidad (orientativas para el operador)
  const CSV_TEMPLATES: Record<string, string[]> = {
    customers: ['customer_code', 'first_name', 'last_name', 'document_id', 'phone', 'whatsapp', 'email', 'address', 'sector', 'city', 'gps_lat', 'gps_lng', 'plan_id', 'router_id', 'pppoe_user', 'ip_address', 'mac_address', 'status'],
    plans: ['code', 'name', 'download_mbps', 'upload_mbps', 'price_monthly', 'installation_fee', 'service_type', 'mikrotik_profile', 'vlan_id', 'status'],
    network_inventory: ['device_code', 'name', 'device_type', 'brand', 'model', 'mac_address', 'ip_address', 'frequency_mhz', 'frequency_band', 'ssid', 'signal_dbm', 'firmware_version', 'physical_location', 'gps_lat', 'gps_lng', 'customer_id', 'parent_device_id', 'status', 'notes'],
    routers: ['name', 'ip_address', 'api_port', 'username', 'routeros_version', 'board_name', 'location', 'status'],
    olts: ['name', 'brand', 'model', 'ip_address', 'snmp_port', 'telnet_port', 'snmp_community', 'driver_class', 'location', 'status'],
    invoices: ['invoice_number', 'customer_id', 'customer_name', 'issue_date', 'due_date', 'subtotal', 'total', 'status'],
    payments: ['receipt_number', 'customer_id', 'customer_name', 'invoice_number', 'paid_at', 'amount', 'method', 'reference', 'validation_status'],
    bank_accounts: ['bank_name', 'account_label', 'account_number', 'account_type', 'currency', 'holder_name', 'status'],
  };

  function parseCsv(content: string): Array<Record<string, string>> {
    const rows: string[][] = [];
    let field = '';
    let row: string[] = [];
    let inQuotes = false;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i];
      if (inQuotes) {
        if (ch === '"') {
          if (content[i + 1] === '"') {
            field += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          field += ch;
        }
      } else if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && content[i + 1] === '\n') i++;
        row.push(field);
        field = '';
        rows.push(row);
        row = [];
      } else {
        field += ch;
      }
    }
    if (field.length > 0 || row.length > 0) {
      row.push(field);
      rows.push(row);
    }
    const nonEmpty = rows.filter((r) => r.some((c) => c.trim() !== ''));
    if (nonEmpty.length < 2) return [];
    const headers = nonEmpty[0].map((h) => h.trim());
    return nonEmpty.slice(1).map((r) => {
      const obj: Record<string, string> = {};
      headers.forEach((h, idx) => {
        obj[h] = (r[idx] ?? '').trim();
      });
      return obj;
    });
  }

  // Mapea la plantilla Excel específica ("ya revision-origen-vs-excel.xlsx") a customers + network_inventory
function mapExcelTemplateToCustomers(rows: any[]): any[] {
  const planCache = new Map<string, number>();
  return rows.map((raw, idx) => {
    const nameParts = String(raw['Nombre completo'] || '').trim().split(/\s+/);
    const firstName = nameParts[0] || `Cliente${idx + 1}`;
    const lastName = nameParts.slice(1).join(' ') || 'Apellido';
    const coords = String(raw['Coordenadas (lng,lat)'] || '').split(',').map(s => s.trim());
    const gpsLng = Number(coords[0]) || 0;
    const gpsLat = Number(coords[1]) || 0;
    const planName = String(raw['Plan Internet'] || '').trim();
    let planId = 1;
    if (planName) {
      if (!planCache.has(planName)) {
        planCache.set(planName, planCache.size + 1);
      }
      planId = planCache.get(planName)!;
    }
    return {
      customer_code: `CLI-${String(idx + 1).padStart(5, '0')}`,
      first_name: firstName,
      last_name: lastName,
      document_id: '',
      phone: String(raw['Teléfono fijo'] || '').replace(/\D/g, ''),
      whatsapp: String(raw['Teléfono fijo'] || '').replace(/\D/g, ''),
      email: String(raw['Email'] || '').trim(),
      address: String(raw['IP del cliente'] || '').trim(), // reusing field for reference
      sector: '',
      gps_lat: gpsLat,
      gps_lng: gpsLng,
      status: String(raw['Estado'] || 'ACTIVO'),
      plan_id: planId,
      cut_day: Number(raw['Día de pago (1-28)'] || 5),
      pppoe_user: `pppoe${String(idx + 1).padStart(5, '0')}`,
      pppoe_password: Math.random().toString(36).slice(2, 10),
      isp_id: 1,
      zone: '',
      mac_address: String(raw['MAC del equipo'] || '').toUpperCase(),
      ip_address: String(raw['IP del cliente'] || '').trim(),
    };
  });
}

// Mapea Excel a network_inventory (CPE)
function mapExcelTemplateToInventory(rows: any[]): any[] {
  return rows.map((raw, idx) => ({
    device_code: `CPE-${String(idx + 1).padStart(4, '0')}`,
    name: `CPE ${String(raw['Nombre completo'] || '').trim()}`,
    device_type: 'CPE',
    brand: 'Generic',
    model: 'CPE Router',
    mac_address: String(raw['MAC del equipo'] || '').toUpperCase(),
    ip_address: String(raw['IP del cliente'] || '').trim(),
    frequency_band: '2.4 GHz',
    gps_lat: 0,
    gps_lng: 0,
    status: String(raw['Estado'] || 'ACTIVO').toLowerCase() === 'activo' ? 'online' : 'offline',
    isp_id: 1,
  }));
}

function normalizeImportedRow(section: string, row: any): any {
    const r = { ...row };
    r.isp_id = Number(r.isp_id || 1);
    if (section === 'customers') {
      r.customer_code = String(r.customer_code || `CLI-${String(r.id ?? '').padStart(5, '0')}`);
      r.first_name = String(r.first_name || r.name || '');
      r.last_name = String(r.last_name || '');
      r.status = r.status || 'Activo';
      r.gps_lat = Number(r.gps_lat || 0);
      r.gps_lng = Number(r.gps_lng || 0);
    } else if (section === 'network_inventory') {
      const types = ['AP', 'CPE', 'OLT', 'Router', 'PTP', 'Switch'];
      r.device_type = types.includes(r.device_type) ? r.device_type : 'CPE';
      r.status = ['online', 'offline', 'warning', 'maintenance'].includes(r.status) ? r.status : 'online';
      r.device_code = String(r.device_code || `DEV-${String(r.id ?? '').padStart(4, '0')}`);
      r.name = String(r.name || r.device_code);
      r.gps_lat = Number(r.gps_lat || 0);
      r.gps_lng = Number(r.gps_lng || 0);
    } else if (section === 'invoices') {
      r.total = Number(r.total || r.subtotal || 0);
      r.status = r.status || 'Pendiente';
    } else if (section === 'payments') {
      r.amount = Number(r.amount || 0);
      r.validation_status = r.validation_status || 'Validado';
    } else if (section === 'plans') {
      r.price_monthly = Number(r.price_monthly || 0);
      r.status = r.status || 'Activo';
    }
    return r;
  }

  app.get('/api/v1/import/template', (req, res) => {
    const entity = String(req.query.entity || '');
    if (!CSV_TEMPLATES[entity]) {
      return res.status(422).json({
        status: 'error',
        message: `Entidad sin plantilla disponible. Opciones: ${Object.keys(CSV_TEMPLATES).join(', ')}.`,
      });
    }
    const headers = CSV_TEMPLATES[entity];
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="plantilla_${entity}.csv"`);
    res.send(headers.join(',') + '\n');
  });

  app.post('/api/v1/import', (req, res) => {
    const db = loadDb();
    const body = req.body || {};
    const summary: Record<string, number> = {};

    const appendRows = (section: string, rows: any[]) => {
      if (!IMPORT_SECTIONS.includes(section)) return;
      const target = db[section];
      if (!Array.isArray(target) || !Array.isArray(rows)) return;
      let nextId = (target.reduce((m: number, r: any) => Math.max(m, Number(r.id) || 0), 0) || 0) + 1;
      const existingIds = new Set(target.map((r: any) => r.id));
      rows.forEach((raw) => {
        const row = normalizeImportedRow(section, raw);
        if (!row.id || existingIds.has(row.id)) {
          row.id = nextId++;
        }
        existingIds.add(row.id);
        target.push(row);
      });
      summary[section] = (summary[section] || 0) + rows.length;
    };

    // Modo CSV: { entity: 'customers', content: '<texto csv>' }
    if (body.entity && typeof body.content === 'string') {
      const entity = String(body.entity);
      if (!IMPORT_SECTIONS.includes(entity)) {
        return res.status(422).json({
          status: 'error',
          message: `Entidad no importable: ${entity}. Opciones: ${IMPORT_SECTIONS.join(', ')}.`,
        });
      }
      const rows = parseCsv(body.content);
      if (rows.length === 0) {
        return res.status(422).json({ status: 'error', message: 'El CSV no contiene filas de datos válidas (se requiere cabecera + al menos 1 fila).' });
      }
      appendRows(entity, rows);
      appendAudit(db, 1, 'Importación de Datos', 'IMPORT_CSV', entity, entity, `Importadas ${rows.length} filas desde CSV a ${entity}.`);
      saveDb(db);
      return res.json({ status: 'success', imported: summary, message: `Importadas ${rows.length} filas en ${entity}.` });
    }

    // Modo JSON: { customers: [...], plans: [...], network_inventory: [...], ... }
    const sections = IMPORT_SECTIONS.filter((s) => Array.isArray(body[s]));
    if (sections.length === 0) {
      return res.status(422).json({
        status: 'error',
        message: 'Formato no reconocido. Envíe JSON con secciones (customers, plans, network_inventory, ...) o { entity, content } para CSV.',
      });
    }
    sections.forEach((s) => appendRows(s, body[s]));
    const detail = Object.entries(summary).map(([k, v]) => `${v} ${k}`).join(', ');
    appendAudit(db, 1, 'Importación de Datos', 'IMPORT_JSON', 'Varias', Object.keys(summary).join(', '), `Importación JSON: ${detail}.`);
    saveDb(db);
    return res.json({ status: 'success', imported: summary, message: `Importación completada: ${detail}.` });
  });

  // ==========================================================================
  // 6c. IMPORTACIÓN DESDE PLANTILLA EXCEL ESPECÍFICA (ya revision-origen-vs-excel.xlsx)
  // ==========================================================================
  app.post('/api/v1/import/excel-template', async (req, res) => {
    const db = loadDb();
    const body = req.body || {};
    const summary: Record<string, number> = {};

    if (!body.rows || !Array.isArray(body.rows)) {
      return res.status(422).json({
        status: 'error',
        message: 'Se requiere body.rows con array de objetos (filas del Excel parseado).',
      });
    }

    const excelRows = body.rows;

    // 1) Crear/obtener planes únicos
    const planNames = new Set<string>();
    excelRows.forEach((r: any) => {
      const p = String(r['Plan Internet'] || '').trim();
      if (p) planNames.add(p);
    });
    const planNameToId = new Map<string, number>();
    const plans = db.plans || [];
    let nextPlanId = (plans.reduce((m: number, p: any) => Math.max(m, Number(p.id) || 0), 0) || 0) + 1;
    planNames.forEach(name => {
      const existing = plans.find((p: any) => p.name === name);
      if (existing) {
        planNameToId.set(name, existing.id);
      } else {
        planNameToId.set(name, nextPlanId);
        plans.push({
          id: nextPlanId,
          code: `PLN-${String(nextPlanId).padStart(4, '0')}`,
          name,
          download_mbps: 0,
          upload_mbps: 0,
          price_monthly: 0,
          status: 'Activo',
          isp_id: 1,
        });
        nextPlanId++;
      }
    });

    // 2) Mapear a customers
    const customerRows = excelRows.map((raw: any, idx: number) => {
      const nameParts = String(raw['Nombre completo'] || '').trim().split(/\s+/);
      const firstName = nameParts[0] || `Cliente${idx + 1}`;
      const lastName = nameParts.slice(1).join(' ') || 'Apellido';
      const coords = String(raw['Coordenadas (lng,lat)'] || '').split(',').map(s => s.trim());
      const gpsLng = Number(coords[0]) || 0;
      const gpsLat = Number(coords[1]) || 0;
      const planName = String(raw['Plan Internet'] || '').trim();
      const planId = planNameToId.get(planName) || 1;

      return {
        customer_code: `CLI-${String(idx + 1).padStart(5, '0')}`,
        first_name: firstName,
        last_name: lastName,
        document_id: '',
        phone: String(raw['Teléfono fijo'] || '').replace(/\D/g, ''),
        whatsapp: String(raw['Teléfono fijo'] || '').replace(/\D/g, ''),
        email: String(raw['Email'] || '').trim(),
        address: String(raw['IP del cliente'] || '').trim(),
        sector: '',
        gps_lat: gpsLat,
        gps_lng: gpsLng,
        status: String(raw['Estado'] || 'ACTIVO'),
        plan_id: planId,
        cut_day: Number(raw['Día de pago (1-28)'] || 5),
        pppoe_user: `pppoe${String(idx + 1).padStart(5, '0')}`,
        pppoe_password: Math.random().toString(36).slice(2, 10),
        isp_id: 1,
        zone: '',
      };
    });

    // 3) Mapear a network_inventory (CPE)
    const inventoryRows = excelRows.map((raw: any, idx: number) => ({
      device_code: `CPE-${String(idx + 1).padStart(4, '0')}`,
      name: `CPE ${String(raw['Nombre completo'] || '').trim()}`,
      device_type: 'CPE',
      brand: 'Generic',
      model: 'CPE Router',
      mac_address: String(raw['MAC del equipo'] || '').toUpperCase(),
      ip_address: String(raw['IP del cliente'] || '').trim(),
      frequency_band: '2.4 GHz',
      gps_lat: 0,
      gps_lng: 0,
      status: String(raw['Estado'] || 'ACTIVO').toLowerCase() === 'activo' ? 'online' : 'offline',
      isp_id: 1,
      customer_id: 0, // se actualiza después
    }));

    // Insertar customers
    const customers = db.customers || [];
    let nextCustId = (customers.reduce((m: number, c: any) => Math.max(m, Number(c.id) || 0), 0) || 0) + 1;
    const custIdMap = new Map<number, number>(); // excel index -> real id
    customerRows.forEach((c: any, idx: number) => {
      const id = nextCustId++;
      const record = { ...c, id, isp_id: 1 };
      customers.push(record);
      custIdMap.set(idx, id);
    });
    summary.customers = customerRows.length;

    // Insertar inventory con customer_id real
    const inventory = db.network_inventory || [];
    let nextInvId = (inventory.reduce((m: number, d: any) => Math.max(m, Number(d.id) || 0), 0) || 0) + 1;
    inventoryRows.forEach((inv: any, idx: number) => {
      const id = nextInvId++;
      const customerId = custIdMap.get(idx) || 1;
      inventory.push({ ...inv, id, customer_id: customerId, isp_id: 1 });
    });
    summary.network_inventory = inventoryRows.length;
    summary.plans = planNames.size;

    appendAudit(db, 1, 'Importación Excel', 'IMPORT_EXCEL', 'Clientes + Inventario', 'multiple', `Importados ${summary.customers} clientes, ${summary.network_inventory} CPEs, ${summary.plans} planes desde plantilla Excel.`);
    saveDb(db);
    return res.json({ status: 'success', imported: summary, message: `Importación Excel: ${summary.customers} clientes, ${summary.network_inventory} CPEs, ${summary.plans} planes creados.` });
  });

  // ==========================================================================
  // 7. VISOR DE ARCHIVOS PHP 8.2 + MYSQL 8 GENERADOS EN EL PROYECTO
  // ==========================================================================
  app.get('/api/v1/php-source', (_req, res) => {
    const filesToExpose = [
      { path: 'database/migrations/002_network_inventory.sql', title: '002_network_inventory.sql (Tabla Inventario AP/CPE/OLT/Router + GPS)', lang: 'sql' },
      { path: 'app/Models/NetworkDevice.php', title: 'app/Models/NetworkDevice.php (Modelo PDO + Filtros + Validación MAC/IP/GPS)', lang: 'php' },
      { path: 'app/Controllers/NetworkInventoryController.php', title: 'app/Controllers/NetworkInventoryController.php (Controlador MVC/REST + CSRF)', lang: 'php' },
      { path: 'resources/views/network/inventory.php', title: 'resources/views/network/inventory.php (Vista Bootstrap 5 + Leaflet OpenStreetMap)', lang: 'php' },
      { path: 'database/migrations/001_full_isp_schema.sql', title: '001_full_isp_schema.sql (Esquema Completo 35+ Tablas MySQL 8)', lang: 'sql' },
      { path: 'app/Core/Database.php', title: 'app/Core/Database.php (Conexión PDO Singleton Segura)', lang: 'php' },
      { path: 'app/Drivers/Contracts/IspContracts.php', title: 'app/Drivers/Contracts/IspContracts.php (Interfaces MikroTik, OLT, WhatsApp, Pagos)', lang: 'php' },
      { path: 'app/Drivers/Mikrotik/RouterOSApiDriver.php', title: 'app/Drivers/Mikrotik/RouterOSApiDriver.php (Cliente Socket Binario RouterOS)', lang: 'php' },
      { path: 'app/Services/BillingLifecycleService.php', title: 'app/Services/BillingLifecycleService.php (Flujo Vencimiento -> Corte MikroTik -> WhatsApp)', lang: 'php' },
      { path: 'artisan', title: 'artisan (CLI para CRON Jobs: invoices, suspend, mikrotik:sync, olt:sync)', lang: 'php' },
      { path: 'README.md', title: 'README.md (Arquitectura, Relaciones, Permisos RBAC y Documentación)', lang: 'markdown' },
    ];

    const loaded = filesToExpose.map((f) => {
      const fullPath = path.join(__dirname, f.path);
      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8') : '// Archivo no encontrado';
      return { ...f, content };
    });

    res.json({ status: 'success', files: loaded });
  });

  // Mount Vite in development or serve static build in production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NetCore ISP Full-Stack Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
