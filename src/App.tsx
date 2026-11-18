import React, { useEffect, useState, useMemo } from 'react';
import NetworkInventoryModule, { NetworkDeviceItem } from './components/NetworkInventoryModule';
import PhpSourceViewer from './components/PhpSourceViewer';
import ScreenNoticePreview from './components/ScreenNoticePreview';
import GenericModule from './components/GenericModule';
import Sidebar, { type NavGroup, type NavItem } from './components/Sidebar';
import FinanceDashboard from './components/FinanceDashboard';
import CustomerStats from './components/CustomerStats';
import RouterTools from './components/RouterTools';
import CompanyProfile from './components/CompanyProfile';
import TicketReply from './components/TicketReply';
import AccountingDashboard from './components/AccountingDashboard';
import IPv6Calculator from './components/IPv6Calculator';
import OltModule from './components/OltModule';
import ApiDocs from './components/ApiDocs';
import { MODULE_MAP } from './lib/registry';
import {
  LayoutDashboard,
  Radio,
  Users,
  Router as RouterIcon,
  Receipt,
  Bot,
  ShieldCheck,
  Code2,
  Globe,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Play,
  Send,
  Plus,
  Eye,
  Power,
  Wifi,
  FileCheck2,
  Terminal,
  Upload,
  X,
  Sun,
  Moon,
  // Iconos del árbol de módulos (réplica de WispHub)
  Wallet,
  BarChart3,
  Map,
  RadioTower,
  HardHat,
  Tv,
  Clapperboard,
  Smartphone,
  FileSignature,
  TrendingUp,
  TrendingDown,
  Tags,
  CreditCard,
  Landmark,
  Scale,
  Clock,
  ShieldBan,
  Ban,
  ServerCog,
  Network,
  Cable,
  KeyRound,
  Gauge,
  Ticket,
  TicketCheck,
  Store,
  LifeBuoy,
  ListChecks,
  Boxes,
  Package,
  BadgeDollarSign,
  Truck,
  Building2,
  History,
  UsersRound,
  Mail,
  MessageCircle,
  LayoutTemplate,
  MonitorPlay,
  BellRing,
  Sparkles,
  BadgeCheck,
  Activity,
  HandCoins,
  CalendarRange,
  Hash,
  BookOpen,
  PiggyBank,
  FileSpreadsheet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type ActiveModule = string;

export default function App() {
  const [activeModule, setActiveModule] = useState<ActiveModule>(() => {
  const VALID_CUSTOM = new Set(['network_inventory', 'dashboard', 'router_tools', 'audit', 'customer_portal', 'php_code', 'api_docs', 'company_profile', 'finance_dashboard', 'customer_stats', 'mikrotik_olt', 'billing_ocr', 'ai_audit']);
  try {
    const stored = localStorage.getItem('netcore.activeModule');
    if (stored && (VALID_CUSTOM.has(stored) || MODULE_MAP[stored])) return stored;
  } catch {}
  return 'network_inventory';
});

  useEffect(() => {
    try { localStorage.setItem('netcore.activeModule', activeModule); } catch {}
  }, [activeModule]);
  const [selectedIspId, setSelectedIspId] = useState<number>(1);
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [toast, setToast] = useState<string | null>(null);

  // Customer 360 Dossier & New Customer Modal
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const [isNewCustomerOpen, setIsNewCustomerOpen] = useState<boolean>(false);
  const [custSearch, setCustSearch] = useState<string>('');
  const [custStatusFilter, setCustStatusFilter] = useState<string>('');
  const [newCustForm, setNewCustForm] = useState({
    first_name: '',
    last_name: '',
    document_id: '',
    phone: '',
    email: '',
    address: '',
    sector: '',
    gps_lat: '',
    gps_lng: '',
    plan_id: '',
    router_id: '',
    pppoe_user: '',
    cpe_brand: '',
    cpe_model: '',
  });

  // Customer Portal State
  const [portalCustomerId, setPortalCustomerId] = useState<number>(0);
  const [wifiSsidInput, setWifiSsidInput] = useState<string>('');
  const [wifiPassInput, setWifiPassInput] = useState<string>('');

  // Data Import State
  const [importLog, setImportLog] = useState<string | null>(null);
  const [importBusy, setImportBusy] = useState<boolean>(false);
  const [csvEntity, setCsvEntity] = useState<string>('customers');
  const [excelImportLog, setExcelImportLog] = useState<string | null>(null);
  const [excelImportBusy, setExcelImportBusy] = useState<boolean>(false);

  // Dark mode state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try { return localStorage.getItem('netcore.darkMode') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('netcore.darkMode', String(darkMode)); } catch {}
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  // Sidebar state persistence
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    try { return localStorage.getItem('netcore.sidebarCollapsed') === 'true'; } catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem('netcore.sidebarCollapsed', String(sidebarCollapsed)); } catch {}
  }, [sidebarCollapsed]);
  
  const [sidebarOpenGroups, setSidebarOpenGroups] = useState<Set<string>>(() => {
    try { 
      const stored = JSON.parse(localStorage.getItem('netcore.sidebarOpenGroups') || '[]');
      const defaults = new Set(['Dashboard']);
      stored.forEach((g: string) => defaults.add(g));
      return defaults;
    } catch { return new Set(['Dashboard']); }
  });
  useEffect(() => {
    try { localStorage.setItem('netcore.sidebarOpenGroups', JSON.stringify(Array.from(sidebarOpenGroups))); } catch {}
  }, [sidebarOpenGroups]);

  // AI Assistant State
  const [aiPrompt, setAiPrompt] = useState<string>('');
  const [aiHistory, setAiHistory] = useState<
    Array<{ role: 'user' | 'assistant'; text: string; tools?: string[] }>
  >([
    {
      role: 'assistant',
      text: 'Bienvenido al Asistente IA de Operaciones ISP. Utilizo funciones autorizadas de solo lectura (sin acceso directo a SQL arbitrario) para consultar el Inventario de Red (AP, CPE, OLT, Routers), Clientes Morosos/Suspendidos, Facturación y Pagos. Si no configuraste una API key de IA, usará el modo de respuestas locales.',
      tools: ['getNetworkInventorySummary', 'getOverdueAndSuspendedCustomers', 'getBillingAndPaymentsSummary'],
    },
  ]);
  const [aiLoading, setAiLoading] = useState<boolean>(false);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 4500);
  };

  const loadBootstrap = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/bootstrap?isp_id=${selectedIspId}`);
      const json = await res.json();
      if (json.status === 'success') {
        setData(json);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadBootstrap();
  }, [selectedIspId]);

  const customers = data?.customers || [];
  const inventory: NetworkDeviceItem[] = data?.network_inventory || [];
  const plans = data?.plans || [];
  const routers = data?.routers || [];
  const olts = data?.olts || [];
  const invoices = data?.invoices || [];
  const payments = data?.payments || [];
  const paymentProofs = data?.payment_proofs || [];
  const paymentPromises = data?.payment_promises || [];
  const tickets = data?.tickets || [];
  const bankAccounts = data?.bank_accounts || [];
  const auditLogs = data?.audit_logs || [];

  const kpis = useMemo(() => {
    const activeCust = customers.filter((c: any) => c.status === 'Activo').length;
    const suspendedCust = customers.filter((c: any) => c.status === 'Suspendido').length;
    const overdueCust = customers.filter((c: any) => c.status === 'Moroso').length;
    const pendingInv = invoices.filter((i: any) => i.status === 'Pendiente').length;
    const overdueInv = invoices.filter((i: any) => i.status === 'Vencida').length;
    const monthRevenue = payments.reduce((acc: number, p: any) => acc + Number(p.amount), 0);
    const openTickets = tickets.filter((t: any) => t.status !== 'Cerrado').length;
    const offlineDevices = inventory.filter((d) => d.status === 'offline' || d.status === 'warning').length;
    
    // Cobrado hoy (pagos con fecha de hoy)
    const today = new Date().toISOString().slice(0, 10);
    const collectedToday = payments
      .filter((p: any) => String(p.paid_at || '').slice(0, 10) === today)
      .reduce((acc: number, p: any) => acc + Number(p.amount), 0);
    
    // Por cobrar (facturas pendientes + vencidas)
    const pendingCollection = invoices
      .filter((i: any) => i.status === 'Pendiente' || i.status === 'Vencida')
      .reduce((acc: number, i: any) => acc + Number(i.total || 0), 0);

    return {
      totalCustomers: customers.length,
      activeCust,
      suspendedCust,
      overdueCust,
      pendingInv,
      overdueInv,
      monthRevenue,
      openTickets,
      totalDevices: inventory.length,
      offlineDevices,
      pendingOcr: paymentProofs.filter((p: any) => p.status === 'Pendiente de revisión').length,
      collectedToday,
      pendingCollection,
    };
  }, [customers, invoices, payments, tickets, inventory, paymentProofs]);

  // Ingresos reales por mes (derivados de los pagos registrados, sin datos simulados)
  const revenueByMonth = useMemo(() => {
    const now = new Date();
    const months: Array<{ key: string; label: string; amount: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
        label: d.toLocaleDateString('es', { month: 'short' }),
        amount: 0,
      });
    }
    payments.forEach((p: any) => {
      const key = String(p.paid_at || '').slice(0, 7);
      const bucket = months.find((m) => m.key === key);
      if (bucket) bucket.amount += Number(p.amount) || 0;
    });
    const max = Math.max(1, ...months.map((m) => m.amount));
    return months.map((m) => ({ ...m, pct: Math.round((m.amount / max) * 100) }));
  }, [payments]);

  const hasRevenueData = revenueByMonth.some((m) => m.amount > 0);

  // Dashboard interactivity state
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30); // seconds
  const [selectedMonthKey, setSelectedMonthKey] = useState<string | null>(null);
  const [liveStatus, setLiveStatus] = useState<Record<string, { online: boolean; lastCheck: string }>>({});
  const [notifications, setNotifications] = useState<Array<{ id: number; type: string; message: string; time: string; read: boolean }>>([]);

  // Auto-refresh effect
  useEffect(() => {
    if (!autoRefresh) return;
    const timer = setInterval(() => {
      loadBootstrap();
    }, refreshInterval * 1000);
    return () => clearInterval(timer);
  }, [autoRefresh, refreshInterval]);

  // Live status polling for routers/OLTs
  useEffect(() => {
    const pollLiveStatus = async () => {
      try {
        const statuses: Record<string, { online: boolean; lastCheck: string }> = {};
        for (const r of routers) {
          if (r.ip_address) {
            const res = await fetch(`/api/v1/routers/${r.id}/test`, { method: 'POST' });
            const json = await res.json();
            statuses[`router-${r.id}`] = { online: json.ok === true, lastCheck: new Date().toLocaleTimeString() };
          }
        }
        for (const o of olts) {
          if (o.ip_address) {
            const res = await fetch(`/api/v1/olts/${o.id}/test`, { method: 'POST' });
            const json = await res.json();
            statuses[`olt-${o.id}`] = { online: json.ok === true, lastCheck: new Date().toLocaleTimeString() };
          }
        }
        setLiveStatus(statuses);
      } catch (e) {
        console.error('Live status poll error:', e);
      }
    };
    pollLiveStatus();
    const timer = setInterval(pollLiveStatus, 60000); // every minute
    return () => clearInterval(timer);
  }, [routers, olts]);

  // Generate notifications from data changes
  useEffect(() => {
    const newNotifications: Array<{ id: number; type: string; message: string; time: string; read: boolean }> = [];
    const now = new Date().toLocaleTimeString();
    
    // Check for overdue invoices
    const overdueCount = invoices.filter((i: any) => i.status === 'Vencida').length;
    if (overdueCount > 0) {
      newNotifications.push({ id: Date.now(), type: 'warning', message: `${overdueCount} factura(s) vencida(s)`, time: now, read: false });
    }
    
    // Check for pending payment proofs
    const pendingProofs = paymentProofs.filter((p: any) => p.status === 'Pendiente de revisión').length;
    if (pendingProofs > 0) {
      newNotifications.push({ id: Date.now() + 1, type: 'info', message: `${pendingProofs} comprobante(s) por revisar`, time: now, read: false });
    }
    
    // Check for offline devices
    const offlineCount = inventory.filter((d: any) => d.status === 'offline' || d.status === 'warning').length;
    if (offlineCount > 0) {
      newNotifications.push({ id: Date.now() + 2, type: 'danger', message: `${offlineCount} dispositivo(s) offline`, time: now, read: false });
    }
    
    // Check for suspended customers
    const suspendedCount = customers.filter((c: any) => c.status === 'Suspendido').length;
    if (suspendedCount > 0) {
      newNotifications.push({ id: Date.now() + 3, type: 'warning', message: `${suspendedCount} cliente(s) suspendido(s)`, time: now, read: false });
    }

    setNotifications(newNotifications);
  }, [invoices, paymentProofs, inventory, customers]);

  const handleToggleCustomerStatus = async (customerId: number) => {
    const res = await fetch(`/api/v1/customers/${customerId}/toggle-status`, {
      method: 'POST',
    });
    const json = await res.json();
    if (json.status === 'success') {
      showToast(json.message);
      loadBootstrap();
    }
  };

  const handleCreateCustomer = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch('/api/v1/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newCustForm),
    });
    const json = await res.json();
    if (json.status === 'success') {
      setIsNewCustomerOpen(false);
      showToast(
        `Cliente ${json.customer.customer_code} creado y CPE registrado automáticamente en el Inventario de Red.`
      );
      loadBootstrap();
    }
  };

  const handleReviewProof = async (proofId: number, decision: 'Aprobado' | 'Rechazado') => {
    const res = await fetch(`/api/v1/payment-proofs/${proofId}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ decision }),
    });
    const json = await res.json();
    if (json.status === 'success') {
      showToast(
        decision === 'Aprobado'
          ? 'Comprobante aprobado: factura marcada Pagada y servicio reactivado en el sistema.'
          : 'Comprobante rechazado.'
      );
      loadBootstrap();
    }
  };

  const handleRunCron = async (command: string) => {
    const res = await fetch('/api/v1/cron/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const json = await res.json();
    if (json.status === 'success') {
      showToast(json.output);
      loadBootstrap();
    }
  };

  const handleImportFile = async (file: File) => {
    setImportBusy(true);
    setImportLog(null);
    try {
      const text = await file.text();
      const isCsv = file.name.toLowerCase().endsWith('.csv');
      const body = isCsv ? { entity: csvEntity, content: text } : JSON.parse(text);
      const res = await fetch('/api/v1/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.status === 'success') {
        setImportLog(json.message);
        showToast(json.message);
        loadBootstrap();
      } else {
        setImportLog(json.message || 'No se pudo importar el archivo.');
      }
    } catch (e: any) {
      setImportLog('Archivo inválido: ' + (e?.message || 'no se pudo leer el contenido.'));
    } finally {
      setImportBusy(false);
    }
  };

  const handleExcelImport = async (file: File) => {
    setExcelImportBusy(true);
    setExcelImportLog(null);
    try {
      const arrayBuffer = await file.arrayBuffer();
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(arrayBuffer, { type: 'array' });
      const sheetName = workbook.SheetNames[0];
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (rows.length === 0) {
        setExcelImportLog('El archivo Excel no contiene datos.');
        return;
      }

      setExcelImportLog(`Procesando ${rows.length} filas...`);

      const res = await fetch('/api/v1/import/excel-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      });
      const json = await res.json();

      if (json.status === 'success') {
        setExcelImportLog(`✅ ${json.message}`);
        showToast(json.message);
        loadBootstrap();
      } else {
        setExcelImportLog(`❌ ${json.message || 'Error en importación'}`);
        showToast(json.message || 'Error en importación');
      }
    } catch (e: any) {
      setExcelImportLog('Error: ' + (e?.message || 'no se pudo procesar el archivo.'));
      showToast('Error procesando Excel: ' + (e?.message || 'desconocido'));
    } finally {
      setExcelImportBusy(false);
    }
  };

  const handleAskAi = async (customQuery?: string) => {
    const q = (customQuery ?? aiPrompt).trim();
    if (!q) return;
    setAiPrompt('');
    setAiHistory((prev) => [...prev, { role: 'user', text: q }]);
    setAiLoading(true);
    try {
      const res = await fetch('/api/v1/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: q }),
      });
      const json = await res.json();
      setAiHistory((prev) => [
        ...prev,
        {
          role: 'assistant',
          text: json.answer || json.message || 'Respuesta recibida.',
          tools: json.tools_invoked,
        },
      ]);
    } catch (e) {
      setAiHistory((prev) => [
        ...prev,
        { role: 'assistant', text: 'Error de comunicación con el servicio IA.' },
      ]);
    } finally {
      setAiLoading(false);
    }
  };

  const selectedCustomer = useMemo(
    () => customers.find((c: any) => c.id === selectedCustomerId) || null,
    [customers, selectedCustomerId]
  );

  const portalCustomer = useMemo(
    () => customers.find((c: any) => c.id === portalCustomerId) || customers[0] || null,
    [customers, portalCustomerId]
  );

  // ==========================================================================
  // Árbol de navegación: réplica de la estructura de módulos de WispHub
  // (Dashboard, Clientes, Finanzas, Sistema, Soporte Técnico,
  //  Almacén, Staff, Ajustes y Mi empresa).
  // ==========================================================================
  const navGroups: NavGroup[] = useMemo(() => {
    const dataItem = (key: string, icon: LucideIcon, label?: string): NavItem => ({
      id: `data:${key}`,
      label: label || MODULE_MAP[key]?.label || key,
      icon,
      badge: (data?.[key] || []).length,
    });
    const customItem = (id: string, label: string, icon: LucideIcon, badge?: number): NavItem => ({
      id,
      label,
      icon,
      badge,
    });

    return [
      {
        group: '📊 Dashboard',
        items: [
          customItem('dashboard', 'Dashboard NOC', LayoutDashboard),
          customItem('finance_dashboard', 'Dashboard Finanzas', Wallet),
          customItem('customer_stats', 'Estadísticas de Clientes', BarChart3),
          customItem('network_inventory', 'Inventario de Red & Mapa', Radio, kpis.totalDevices),
        ],
      },
      {
        group: '👥 Clientes',
        items: [
          customItem('customers', 'Clientes 360° & PPPoE', Users, kpis.totalCustomers),
          dataItem('zones', Map, 'Zonas'),
          dataItem('sectors', RadioTower, 'Sectores'),
          dataItem('installations', HardHat, 'Instalaciones'),
          dataItem('push_devices', Smartphone, 'Push Devices'),
          dataItem('contracts', FileSignature, 'Contratos'),
        ],
      },
      {
        group: '💰 Finanzas',
        items: [
          customItem('billing_ocr', 'Facturación, Pagos & Comprobantes', Receipt, kpis.pendingOcr || undefined),
          dataItem('invoices', FileCheck2, 'Facturas'),
          dataItem('payments', Receipt, 'Pagos'),
          dataItem('payment_promises', FileSignature, 'Promesas de Pago'),
          dataItem('expenses', TrendingDown, 'Gastos'),
          dataItem('expense_categories', Tags, 'Categorías de Gasto'),
          dataItem('payment_methods', CreditCard, 'Métodos de Pago'),
          dataItem('bank_accounts', Landmark, 'Cuentas Bancarias'),
          dataItem('cash_sessions', Wallet, 'Sesiones de Caja'),
          dataItem('reconciliations', Scale, 'Conciliaciones'),
          dataItem('depreciations', PiggyBank, 'Depreciaciones'),
          dataItem('fiscal_years', CalendarRange, 'Años Fiscales'),
          customItem('accounting', 'Contabilidad (P&L, Balance)', BookOpen),
        ],
      },
      {
        group: '⚙️ Sistema & Red',
        items: [
          customItem('mikrotik_olt', 'MikroTik, Queues & OLT', RouterIcon, routers.length + olts.length),
          customItem('router_tools', 'Herramientas de Router', Terminal),
          dataItem('routers', ServerCog, 'Routers MikroTik'),
          dataItem('olts', Cable, 'OLTs FTTH'),
          dataItem('plans', Gauge, 'Planes de Internet'),
          dataItem('olt_alarms', AlertTriangle, 'Alarmas OLT'),
          dataItem('olt_onus', Cable, 'ONUs OLT'),
          dataItem('olt_metrics', Activity, 'Métricas OLT'),
          dataItem('olt_integrations', Cable, 'Integraciones OLT'),
          dataItem('ipv6_prefixes', Network, 'Prefijos IPv6'),
          customItem('ipv6_calculator', 'Calculadora IPv6', Network),
          dataItem('firewall_blocks', ShieldBan, 'Bloqueos Firewall'),
          dataItem('blacklists', Ban, 'Listas Negras'),
          dataItem('radius_users', ServerCog, 'Usuarios RADIUS'),
          dataItem('api_tokens', KeyRound, 'Tokens API'),
          customItem('api_docs', 'Documentación API', KeyRound),
          dataItem('subdomains', Globe, 'Subdominios'),
          customItem('php_code', 'Código PHP & MySQL', Code2),
        ],
      },
      {
        group: '🛠️ Soporte Técnico',
        items: [
          dataItem('tickets', LifeBuoy, 'Tickets'),
          dataItem('ticket_subjects', ListChecks, 'Asuntos de Ticket'),
        ],
      },
      {
        group: '📦 Almacén',
        items: [
          dataItem('warehouse_items', Boxes, 'Items'),
          dataItem('other_items', Package, 'Otros Items'),
          dataItem('other_services', BadgeDollarSign, 'Otros Servicios'),
          dataItem('suppliers', Truck, 'Proveedores'),
          dataItem('branches', Building2, 'Sucursales'),
          dataItem('warehouse_logs', History, 'Logs'),
        ],
      },
      {
        group: '👤 Staff & RRHH',
        items: [
          dataItem('staff', UsersRound, 'Personal'),
          dataItem('roles', ShieldCheck, 'Roles'),
        ],
      },
      {
        group: '⚙️ Ajustes',
        items: [
          dataItem('email_settings', Mail, 'Email'),
          dataItem('notification_settings', MessageCircle, 'Notificaciones'),
          dataItem('templates', LayoutTemplate, 'Plantillas'),
          dataItem('template_tags', Hash, 'Tags Plantilla'),
          dataItem('screen_notices', MonitorPlay, 'Avisos en Pantalla'),
          customItem('screen_notice_preview', 'Avisos (Vista Previa)', MonitorPlay),
          dataItem('notifications', BellRing, 'Notificaciones Push'),
          dataItem('ai_settings', Sparkles, 'Configuración IA'),
          customItem('ai_audit', 'Asistente IA & Auditoría', Bot),
          customItem('customer_portal', 'Portal del Cliente', Globe),
          dataItem('licenses', BadgeCheck, 'Licencias'),
        ],
      },
      {
        group: '🏢 Mi Empresa',
        items: [
          customItem('company_profile', 'Datos de la Empresa', Building2),
        ],
      },
    ];
  }, [data, kpis, routers, olts]);

  const currentNav = useMemo(() => {
    for (const group of navGroups) {
      const item = group.items.find((i) => i.id === activeModule);
      if (item) return { group: group.group, label: item.label };
    }
    return { group: 'Sistema', label: 'Módulo' };
  }, [navGroups, activeModule]);

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] text-[var(--text-primary)] flex flex-col">
      {/* Top Bar Contract: Zone 1 Brand | Zone 2 Key Navigation | Zone 3 Tenant & Quick Actions */}
      {/* Top Bar: breadcrumb, empresa activa y acciones rápidas */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b px-5 py-3 backdrop-blur border-[var(--border-primary)] bg-[var(--header-bg)]/95">
        <div className="hidden items-center gap-2 text-xs text-[var(--text-muted)] sm:flex">
          <span className="text-[var(--text-muted)]">Inicio</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="text-[var(--text-muted)]">{currentNav.group}</span>
          <span className="text-[var(--text-muted)]">/</span>
          <span className="font-medium text-[var(--text-primary)]">{currentNav.label}</span>
        </div>

        <div className="flex items-center gap-3">
          <select
            aria-label="Seleccionar empresa ISP Multi-Tenant"
            value={selectedIspId}
            onChange={(e) => setSelectedIspId(Number(e.target.value))}
            className="rounded-lg border px-3 py-1.5 text-xs text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none bg-[var(--input-bg)] border-[var(--input-border)]"
          >
            {(data?.isps || []).map((isp: any) => (
              <option key={isp.id} value={isp.id}>
                {isp.name} ({isp.plan_code})
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => setActiveModule('customer_portal')}
            className="rounded-lg border px-3.5 py-1.5 text-xs font-medium text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors whitespace-nowrap border-[var(--border-primary)] bg-[var(--bg-secondary)]"
          >
            Portal Cliente
          </button>

          <button
            type="button"
            onClick={loadBootstrap}
            className="inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold text-slate-950 hover:bg-[var(--accent-primary-hover)] whitespace-nowrap bg-[var(--accent-primary)]"
          >
            <RefreshCw className={"h-3.5 w-3.5 " + (loading ? 'animate-spin' : '')} />
            Sincronizar
          </button>

          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            title={darkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
            className="rounded-lg border p-1.5 text-[var(--text-muted)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors border-[var(--border-primary)] bg-[var(--bg-secondary)]"
            aria-label={darkMode ? 'Modo claro' : 'Modo oscuro'}
          >
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </button>
        </div>
      </header>

      {/* Workspace: menú lateral agrupado (réplica de WispHub) + viewport */}
      <div className="flex flex-1 min-w-0">
        <Sidebar
          groups={navGroups}
          activeId={activeModule}
          onSelect={(id) => setActiveModule(id)}
          ispName={data?.isps?.[0]?.name || 'Mi ISP'}
          ispPlan={data?.isps?.[0]?.plan_code || 'STANDARD'}
          userName="Admin Operaciones"
          userRole="Administrador General"
          onOpenPortal={() => setActiveModule('customer_portal')}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
          openGroups={sidebarOpenGroups}
          onOpenGroupsChange={setSidebarOpenGroups}
        />

        {/* Main Viewport */}
        <main className="flex-1 min-w-0 p-5 lg:p-7 max-w-[1440px] mx-auto w-full">
          {toast && (
            <div className="mb-5 flex items-center justify-between rounded-lg border border-sky-500/40 bg-sky-950/60 px-4 py-3 text-xs text-sky-200">
              <span className="font-mono">{toast}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* ================================================================
              MODULE 1: NETWORK INVENTORY & LEAFLET GIS MAP
             ================================================================ */}
          {activeModule === 'network_inventory' && (
            <NetworkInventoryModule
              customers={customers}
              onInventoryChange={loadBootstrap}
              onSelectCustomer={(cid) => {
                setSelectedCustomerId(cid);
                setActiveModule('customers');
              }}
            />
          )}

          {/* ================================================================
              MODULE 2: EXECUTIVE NOC & BILLING DASHBOARD
             ================================================================ */}
          {activeModule === 'dashboard' && (
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
                    {routers.map((r: any) => (
                      <span key={"router-" + r.id} className="flex items-center gap-1" title={r.name}>
                        <span className={"w-2 h-2 rounded-full " + (liveStatus["router-" + r.id]?.online ? "bg-emerald-500" : "bg-rose-500")} />
                        <span className="text-[10px] font-mono">{liveStatus["router-" + r.id]?.lastCheck || "—"}</span>
                      </span>
                    ))}
                    {olts.map((o: any) => (
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
                    <RefreshCw className={"h-3.5 w-3.5 " + (loading ? 'animate-spin' : '')} />
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
                        className={
                          "inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium " +
                          (n.type === "warning" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                           n.type === "danger" ? "bg-rose-500/20 text-rose-300 border border-rose-500/30" :
                           "bg-sky-500/20 text-sky-300 border border-sky-500/30")
                        }
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
              <div className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-6">
                <button
                  type="button"
                  onClick={() => setActiveModule('data:customers')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Total Clientes</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-100">
                    {kpis.totalCustomers}
                  </div>
                  <div className="mt-1 text-xs text-emerald-400">{kpis.activeCust} activos</div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('data:customers')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Suspendidos / Morosos</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-rose-400">
                    {kpis.suspendedCust + kpis.overdueCust}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {kpis.suspendedCust} cortados · {kpis.overdueCust} morosos
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('billing_ocr')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Ingresos del Mes</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                    ${kpis.monthRevenue.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {payments.length} pagos validados
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('data:invoices')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Facturas Vencidas</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400">
                    {kpis.overdueInv}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {kpis.pendingInv} pendientes por vencer
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('network_inventory')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Inventario Red (AP/CPE/OLT)</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-sky-400">
                    {kpis.totalDevices}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    {routers.length} MikroTik · {olts.length} OLTs
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setActiveModule('data:tickets')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Tickets & Comprobantes Pendientes</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-slate-100">
                    {kpis.openTickets}
                  </div>
                  <div className="mt-1 text-xs text-amber-400">
                    {kpis.pendingOcr} comprobante(s) por revisar
                  </div>
                </button>

                {/* Cobrado Hoy */}
                <button
                  type="button"
                  onClick={() => setActiveModule('billing_ocr')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Cobrado Hoy</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-400">
                    ${kpis.collectedToday.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Pagos registrados hoy
                  </div>
                </button>

                {/* Por Cobrar */}
                <button
                  type="button"
                  onClick={() => setActiveModule('data:invoices')}
                  className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 hover:border-sky-500/50 hover:bg-slate-900/80 transition-all cursor-pointer text-left"
                >
                  <div className="text-xs text-slate-400">Por Cobrar</div>
                  <div className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-400">
                    ${kpis.pendingCollection.toFixed(2)}
                  </div>
                  <div className="mt-1 text-xs text-slate-400">
                    Facturas pendientes + vencidas
                  </div>
                </button>
              </div>

              {/* Charts & Traffic Telemetry Row */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
                <div className="lg:col-span-7 rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-sm font-semibold text-slate-100">
                        Evolución de Ingresos Mensuales y Recaudación (USD)
                      </h2>
                      <p className="text-xs text-slate-400">
                        Facturación emitida vs pagos conciliados últimos 6 meses
                      </p>
                    </div>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {payments.length} pago(s) registrado(s)
                    </span>
                  </div>

                  <div className="grid grid-cols-6 gap-3 pt-4 items-end h-44 border-b border-slate-800 pb-3">
                    {revenueByMonth.map((bar) => (
                      <div key={bar.key} className="flex flex-col items-center gap-1.5 h-full justify-end">
                        <span className="font-mono text-[10px] text-slate-400 tabular-nums">
                          ${bar.amount.toLocaleString('es', { maximumFractionDigits: 0 })}
                        </span>
                        <div
                          style={{ height: `${Math.max(bar.pct, bar.amount > 0 ? 4 : 0)}%` }}
                          className="w-full max-w-[42px] rounded-t-md bg-sky-500/80 hover:bg-sky-400 transition-colors"
                        />
                        <span className="text-xs text-slate-300 font-medium capitalize">{bar.label}</span>
                      </div>
                    ))}
                  </div>
                  {!hasRevenueData && (
                    <p className="text-xs text-slate-500">
                      Sin pagos registrados todavía: la gráfica se construye con tus pagos reales.
                    </p>
                  )}
                </div>

                {/* Automated CRON & CLI Execution Panel */}
                <div className="lg:col-span-5 rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                  <div>
                    <h2 className="text-sm font-semibold text-slate-100">
                      Automatización CRON & Cortes Automáticos (`php artisan`)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Ejecuta las tareas programadas del ciclo de facturación y sincronización. Los cortes intentan aplicarse en RouterOS cuando hay un router con IP y el cliente tiene usuario PPPoE.
                    </p>
                  </div>

                  <div className="space-y-2 pt-1">
                    {[
                      {
                        cmd: 'invoices:generate',
                        desc: 'Generar facturación mensual automática',
                      },
                      {
                        cmd: 'invoices:check-overdue',
                        desc: 'Detectar facturas vencidas y marcar mora',
                      },
                      {
                        cmd: 'customers:suspend',
                        desc: 'Suspender morosos (BD) y cortar PPPoE en RouterOS',
                      },
                      {
                        cmd: 'mikrotik:sync',
                        desc: 'Leer sesiones PPPoE reales de cada router',
                      },
                      {
                        cmd: 'olt:sync',
                        desc: 'Consultar señal óptica ONUs (SNMP dBm)',
                        pending: true,
                      },
                    ].map((job) => (
                      <div
                        key={job.cmd}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3 py-2"
                      >
                        <div>
                          <div className="font-mono text-xs text-sky-400">
                            php artisan {job.cmd}
                          </div>
                          <div className="text-[11px] text-slate-400">{job.desc}</div>
                          {(job as any).pending && (
                            <span className="mt-1 inline-flex items-center gap-1 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                              Pendiente de integración (SNMP/Telnet)
                            </span>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRunCron(job.cmd)}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 hover:bg-sky-500 hover:text-slate-950 transition-colors whitespace-nowrap"
                        >
                          <Play className="h-3 w-3" />
                          Ejecutar
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Importación de datos reales (JSON / CSV) */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100">
                    Importar datos reales (JSON / CSV)
                  </h2>
                  <p className="text-xs text-slate-400">
                    La aplicación arranca sin datos de ejemplo. Carga aquí tus clientes, planes, inventario de red,
                    facturas, pagos, routers y OLTs reales. En JSON puedes enviar varias secciones a la vez.
                  </p>
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <select
                    value={csvEntity}
                    onChange={(e) => setCsvEntity(e.target.value)}
                    className="rounded-lg border border-slate-800 bg-slate-950 px-3 py-2 text-xs text-slate-200 focus:border-sky-500 focus:outline-none"
                  >
                    <option value="customers">CSV: Clientes</option>
                    <option value="plans">CSV: Planes</option>
                    <option value="network_inventory">CSV: Inventario de red</option>
                    <option value="routers">CSV: Routers MikroTik</option>
                    <option value="olts">CSV: OLTs FTTH</option>
                    <option value="invoices">CSV: Facturas</option>
                    <option value="payments">CSV: Pagos</option>
                    <option value="bank_accounts">CSV: Cuentas bancarias</option>
                  </select>

                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400">
                    <Upload className="h-3.5 w-3.5" />
                    {importBusy ? 'Importando...' : 'Seleccionar archivo (JSON/CSV)'}
                    <input
                      type="file"
                      accept=".json,.csv,application/json,text/csv"
                      className="hidden"
                      disabled={importBusy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) handleImportFile(f);
                        e.target.value = '';
                      }}
                    />
                  </label>

                  <a
                    href={`/api/v1/import/template?entity=${csvEntity}`}
                    className="text-xs text-sky-400 hover:underline whitespace-nowrap"
                  >
                    Descargar plantilla CSV
                  </a>
                </div>

                {importLog && (
                  <div className="rounded-lg border border-sky-500/40 bg-sky-950/40 px-3.5 py-2.5 text-xs text-sky-200 font-mono">
                    {importLog}
                  </div>
                )}

              {/* Importación desde plantilla Excel específica (ya revision-origen-vs-excel.xlsx) */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-5 space-y-3">
                <div>
                  <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 text-sky-400" />
                    Importar desde plantilla Excel (ya revision-origen-vs-excel.xlsx)
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Arrastra o selecciona tu archivo <strong>ya revision-origen-vs-excel.xlsx</strong> con columnas: Nombre completo, Email, Teléfono fijo, IP del cliente, MAC del equipo, Coordenadas (lng,lat), Plan Internet, Estado, Día de pago (1-28), Costo mensual.
                    Se crearán: <strong>Clientes + CPEs en Inventario + Planes únicos</strong>.
                  </p>
                </div>

                <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-amber-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-amber-400">
                  <FileSpreadsheet className="h-3.5 w-3.5" />
                  {excelImportBusy ? 'Importando...' : 'Seleccionar archivo Excel'}
                  <input
                    type="file"
                    accept=".xlsx,.xls"
                    className="hidden"
                    disabled={excelImportBusy}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleExcelImport(f);
                      e.target.value = '';
                    }}
                  />
                </label>

                {excelImportLog && (
                  <div className="rounded-lg border border-amber-500/40 bg-amber-950/40 px-3.5 py-2.5 text-xs text-amber-200 font-mono">
                    {excelImportLog}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* ================================================================
              MODULE 3: CUSTOMERS 360° & PPPoE LIFECYCLE
             ================================================================ */}
          {activeModule === 'customers' && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                    Gestión de Clientes 360°, PPPoE y Vinculación CPE/ONU
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Al dar de alta un cliente se registra su dato PPPoE y su equipo CPE/ONU en el Inventario de Red. El alta del secreto PPPoE en el router se intenta de forma real al cortar/reactivar el servicio si hay un router con IP y credenciales; si no, se aplica solo en la base de datos.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsNewCustomerOpen(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 transition-colors whitespace-nowrap"
                >
                  <Plus className="h-4 w-4" />
                  Nuevo Cliente + PPPoE + CPE
                </button>
              </div>

              {/* Filter Bar */}
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-wrap items-center gap-1 rounded-lg bg-slate-900 p-1 border border-slate-800">
                  {['', 'Activo', 'Moroso', 'Suspendido', 'Instalación pendiente'].map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setCustStatusFilter(st)}
                      className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
                        custStatusFilter === st
                          ? 'bg-sky-500 text-slate-950 font-semibold'
                          : 'text-slate-400 hover:text-slate-100'
                      }`}
                    >
                      {st || 'Todos los Estados'}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  value={custSearch}
                  onChange={(e) => setCustSearch(e.target.value)}
                  placeholder="Buscar por código, cédula, nombre, IP, usuario PPPoE o sector..."
                  className="w-full sm:w-80 rounded-lg border border-slate-800 bg-slate-900 px-3.5 py-2 text-xs text-slate-100 placeholder-slate-500"
                />
              </div>

              {/* Customers Table */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] font-semibold text-slate-400">
                        <th className="py-3 px-4">Código / Cliente</th>
                        <th className="py-3 px-3">Documento / WhatsApp</th>
                        <th className="py-3 px-3">Sector / Coordenadas GPS</th>
                        <th className="py-3 px-3">Usuario PPPoE / IP</th>
                        <th className="py-3 px-3">ONU / CPE / Caja NAP</th>
                        <th className="py-3 px-3 text-right">Consumo Actual</th>
                        <th className="py-3 px-3">Estado</th>
                        <th className="py-3 px-4 text-right">Acciones</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 text-xs">
                      {customers
                        .filter((c: any) => {
                          if (custStatusFilter && c.status !== custStatusFilter) return false;
                          if (custSearch.trim()) {
                            const q = custSearch.toLowerCase();
                            return (
                              c.customer_code.toLowerCase().includes(q) ||
                              c.first_name.toLowerCase().includes(q) ||
                              c.last_name.toLowerCase().includes(q) ||
                              c.document_id.toLowerCase().includes(q) ||
                              c.ip_address.toLowerCase().includes(q) ||
                              c.pppoe_user.toLowerCase().includes(q) ||
                              c.sector.toLowerCase().includes(q)
                            );
                          }
                          return true;
                        })
                        .map((c: any) => (
                          <tr key={c.id} className="hover:bg-slate-800/40 transition-colors">
                            <td className="py-3 px-4">
                              <div className="font-mono font-semibold text-slate-100">
                                {c.customer_code}
                              </div>
                              <div className="text-slate-200 font-medium mt-0.5">
                                {c.first_name} {c.last_name}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono tabular-nums">
                              <div className="text-slate-200">{c.document_id}</div>
                              <div className="text-slate-400 text-[11px]">{c.whatsapp}</div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="text-slate-200">
                                {c.sector} · {c.city}
                              </div>
                              <div className="font-mono text-[11px] text-slate-400">
                                {Number(c.gps_lat).toFixed(5)}, {Number(c.gps_lng).toFixed(5)}
                              </div>
                            </td>
                            <td className="py-3 px-3 font-mono tabular-nums">
                              <div className="text-sky-400">{c.pppoe_user}</div>
                              <div className="text-slate-400 text-[11px]">
                                {c.ip_address} · VLAN {c.vlan_id}
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <div className="font-mono text-slate-200 text-[11px]">
                                {c.onu_serial}
                              </div>
                              <div className="text-slate-400 text-[11px]">
                                {c.nap_box} · {c.pon_port}
                              </div>
                            </td>
                            <td className="py-3 px-3 text-right font-mono tabular-nums">
                              <div className="text-emerald-400">↓ {c.current_rx_mbps} Mbps</div>
                              <div className="text-sky-400 text-[11px]">
                                ↑ {c.current_tx_mbps} Mbps
                              </div>
                            </td>
                            <td className="py-3 px-3">
                              <span
                                className={`font-medium ${
                                  c.status === 'Activo'
                                    ? 'text-emerald-400'
                                    : c.status === 'Suspendido'
                                    ? 'text-rose-400'
                                    : 'text-amber-400'
                                }`}
                              >
                                {c.status}
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right">
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => setSelectedCustomerId(c.id)}
                                  className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-xs text-slate-200 hover:bg-slate-800 whitespace-nowrap"
                                >
                                  Ficha 360°
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleToggleCustomerStatus(c.id)}
                                  className={`rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap ${
                                    c.status === 'Suspendido'
                                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 hover:bg-emerald-500/30'
                                      : 'bg-rose-500/20 text-rose-300 border border-rose-500/40 hover:bg-rose-500/30'
                                  }`}
                                >
                                  {c.status === 'Suspendido' ? 'Reactivar MikroTik' : 'Cortar MikroTik'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 360° Customer Dossier Drawer/Card */}
              {selectedCustomer && (
                <div className="rounded-xl border border-sky-500/40 bg-slate-900 p-5 space-y-4">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h2 className="text-base font-semibold text-slate-100">
                        Ficha Integral 360° · {selectedCustomer.first_name}{' '}
                        {selectedCustomer.last_name} ({selectedCustomer.customer_code})
                      </h2>
                      <p className="text-xs text-slate-400">
                        Dirección: {selectedCustomer.address} · GPS: {selectedCustomer.gps_lat},{' '}
                        {selectedCustomer.gps_lng}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedCustomerId(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 gap-4 md:grid-cols-4 text-xs">
                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-1">
                      <div className="font-semibold text-sky-400">Conexión PPPoE & MikroTik</div>
                      <div>Usuario: <code className="text-slate-200">{selectedCustomer.pppoe_user}</code></div>
                      <div>IP Asignada: <code className="text-slate-200">{selectedCustomer.ip_address}</code></div>
                      <div>MAC CPE/ONU: <code className="text-slate-200">{selectedCustomer.mac_address}</code></div>
                      <div>VLAN ID: <code className="text-slate-200">{selectedCustomer.vlan_id}</code></div>
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-1">
                      <div className="font-semibold text-purple-400">Infraestructura FTTH / WISP</div>
                      <div>Serial ONU/CPE: <code className="text-slate-200">{selectedCustomer.onu_serial}</code></div>
                      <div>Puerto PON / AP: <code className="text-slate-200">{selectedCustomer.pon_port}</code></div>
                      <div>Caja NAP / Nodo: <span className="text-slate-200">{selectedCustomer.nap_box}</span></div>
                      <div>SSID WiFi: <code className="text-emerald-400">{selectedCustomer.wifi_ssid}</code></div>
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-1">
                      <div className="font-semibold text-emerald-400">Facturación y Pagos</div>
                      {invoices
                        .filter((i: any) => i.customer_id === selectedCustomer.id)
                        .map((inv: any) => (
                          <div key={inv.id} className="font-mono text-[11px]">
                            {inv.invoice_number} · ${inv.total.toFixed(2)} ·{' '}
                            <span className="text-amber-300">{inv.status}</span>
                          </div>
                        ))}
                    </div>

                    <div className="rounded-lg border border-slate-800 bg-slate-950 p-3.5 space-y-1">
                      <div className="font-semibold text-amber-400">Notas & Comunicaciones</div>
                      <p className="text-slate-300 leading-relaxed">{selectedCustomer.notes}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ================================================================
              MODULE 4: MIKROTIK ROUTEROS, SIMPLE QUEUES, PCQ & OLT FTTH
             ================================================================ */}
          {activeModule === 'mikrotik_olt' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                  Integración MikroTik RouterOS (PPPoE, Simple Queue, PCQ) y OLT FTTH
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  MikroTik: cliente API RouterOS <span className="text-emerald-400">real</span> (protocolo binario, puertos 8728/8729) para ejecutar herramientas, sincronizar sesiones y aplicar cortes PPPoE. OLT FTTH: los equipos se registran como inventario; la lectura por SNMP 161 / Telnet 23 está <span className="text-amber-400">pendiente de integración</span>.
                </p>
              </div>

              {/* Routers MikroTik Cards */}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {routers.map((r: any) => (
                  <div
                    key={r.id}
                    className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-3"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm font-semibold text-slate-100">{r.name}</div>
                        <div className="font-mono text-xs text-sky-400">
                          {r.ip_address}:{r.api_port} · {r.board_name} · RouterOS {r.routeros_version}
                        </div>
                      </div>
                      <span className="text-xs font-medium text-emerald-400">
                        Conectado ({r.uptime})
                      </span>
                    </div>

                    <div className="grid grid-cols-4 gap-2 pt-2 font-mono text-xs tabular-nums">
                      <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
                        <div className="text-[10px] text-slate-400">CPU Load</div>
                        <div className="text-sm font-semibold text-slate-100">{r.cpu_load}%</div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
                        <div className="text-[10px] text-slate-400">RAM Usada</div>
                        <div className="text-sm font-semibold text-slate-100">
                          {r.ram_used_mb}/{r.ram_total_mb}M
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
                        <div className="text-[10px] text-slate-400">PPPoE Activos</div>
                        <div className="text-sm font-semibold text-emerald-400">
                          {r.active_pppoe}
                        </div>
                      </div>
                      <div className="rounded border border-slate-800 bg-slate-950 p-2.5">
                        <div className="text-[10px] text-slate-400">Tráfico WAN</div>
                        <div className="text-sm font-semibold text-sky-400">
                          {r.rx_mbps} Mbps
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Plans & PCQ / Simple Queue Binding */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
                  Planes de Internet Vinculados a Perfiles PPPoE / Simple Queue / PCQ en MikroTik
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] text-slate-400">
                        <th className="py-2.5 px-4">Código / Plan</th>
                        <th className="py-2.5 px-3">Descarga / Subida</th>
                        <th className="py-2.5 px-3">Perfil MikroTik / PCQ</th>
                        <th className="py-2.5 px-3">VLAN</th>
                        <th className="py-2.5 px-3 text-right">Precio Mensual</th>
                        <th className="py-2.5 px-4 text-right">Instalación</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 font-mono tabular-nums">
                      {plans.map((p: any) => (
                        <tr key={p.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 font-sans">
                            <span className="font-mono font-semibold text-slate-100">
                              {p.code}
                            </span>{' '}
                            · {p.name}
                          </td>
                          <td className="py-2.5 px-3 text-emerald-400">
                            {p.download_mbps} Mbps / {p.upload_mbps} Mbps
                          </td>
                          <td className="py-2.5 px-3 text-sky-400">
                            {p.mikrotik_profile} ({p.pcq_rate})
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">VLAN {p.vlan_id}</td>
                          <td className="py-2.5 px-3 text-right text-slate-100">
                            ${Number(p.price_monthly).toFixed(2)}
                          </td>
                          <td className="py-2.5 px-4 text-right text-slate-400">
                            ${Number(p.installation_fee).toFixed(2)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* OLT FTTH Table */}
              <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
                  Cabeceras OLT FTTH Registradas (inventario; lectura SNMP/Telnet pendiente de integración)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] text-slate-400">
                        <th className="py-2.5 px-4">OLT / Ubicación</th>
                        <th className="py-2.5 px-3">Marca · Modelo · Driver</th>
                        <th className="py-2.5 px-3">IP Gestión · SNMP · Telnet</th>
                        <th className="py-2.5 px-3 text-right">Puertos PON</th>
                        <th className="py-2.5 px-3 text-right">ONUs Activas / LOS</th>
                        <th className="py-2.5 px-4 text-right">Temp</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {olts.map((o: any) => (
                        <tr key={o.id} className="hover:bg-slate-800/40">
                          <td className="py-2.5 px-4 font-medium text-slate-100">
                            {o.name} <span className="text-slate-500">·</span>{' '}
                            <span className="text-slate-400">{o.location}</span>
                          </td>
                          <td className="py-2.5 px-3">
                            {o.brand} {o.model} ·{' '}
                            <code className="text-purple-400">{o.driver_class}</code>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-sky-400">
                            {o.ip_address} · UDP/{o.snmp_port} · TCP/{o.telnet_port}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            {o.pon_ports_total} PON
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                            <span className="text-emerald-400">{o.onus_active} OK</span> ·{' '}
                            <span className="text-rose-400">{o.onus_los} LOS</span>
                          </td>
                          <td className="py-2.5 px-4 text-right font-mono tabular-nums text-slate-300">
                            {o.temperature_c} °C
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODULE 5: BILLING, PAYMENTS, OCR RECEIPT REVIEW & PROMISES
             ================================================================ */}
          {activeModule === 'billing_ocr' && (
            <div className="space-y-6">
              <div className="border-b border-slate-800 pb-5">
                <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                  Facturación, Pagos, Recepción de Comprobantes y Promesas de Pago
                </h1>
                <p className="mt-1 text-sm text-slate-400">
                  Registra los comprobantes recibidos por el portal y mantenlos en «Pendiente de revisión» hasta su
                  validación administrativa. La lectura automática del comprobante (OCR) no está implementada: los
                  datos se ingresan manualmente al registrar cada pago.
                </p>
              </div>

              {/* Cola de revisión de comprobantes */}
              <div className="rounded-lg border border-amber-500/30 bg-slate-900/80 overflow-hidden">
                <div className="flex items-center justify-between border-b border-slate-800 px-4 py-3">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <FileCheck2 className="h-4 w-4" />
                    Cola de Revisión de Comprobantes Recibidos por el Portal
                  </div>
                  <span className="font-mono text-[11px] text-slate-400">
                    Validación manual obligatoria
                  </span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] text-slate-400">
                        <th className="py-2.5 px-4">Cliente / Factura</th>
                        <th className="py-2.5 px-3">Canal</th>
                        <th className="py-2.5 px-3">Banco reportado</th>
                        <th className="py-2.5 px-3">Referencia / Fecha</th>
                        <th className="py-2.5 px-3 text-right">Monto declarado</th>
                        <th className="py-2.5 px-3">Estado</th>
                        <th className="py-2.5 px-4 text-right">Validación Administrativa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70">
                      {paymentProofs.map((proof: any) => (
                        <tr key={proof.id} className="hover:bg-slate-800/40">
                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-100">{proof.customer_name}</div>
                            <div className="font-mono text-[11px] text-sky-400">
                              {proof.invoice_number}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-slate-300">{proof.source_channel}</td>
                          <td className="py-3 px-3 font-medium text-slate-200">
                            {proof.ocr_extracted_bank}
                            <div className="font-mono text-[10px] text-emerald-400">
                              Confianza declarada: {proof.ocr_confidence}%
                            </div>
                          </td>
                          <td className="py-3 px-3 font-mono tabular-nums">
                            <div className="text-slate-100">{proof.ocr_extracted_reference}</div>
                            <div className="text-[11px] text-slate-400">
                              {proof.ocr_extracted_date}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums font-semibold text-emerald-400">
                            ${Number(proof.ocr_extracted_amount).toFixed(2)}
                          </td>
                          <td className="py-3 px-3 font-medium text-amber-300">
                            {proof.status}
                          </td>
                          <td className="py-3 px-4 text-right">
                            {proof.status === 'Pendiente de revisión' ? (
                              <div className="inline-flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleReviewProof(proof.id, 'Aprobado')}
                                  className="rounded-md bg-emerald-500 px-2.5 py-1 text-xs font-semibold text-slate-950 hover:bg-emerald-400 whitespace-nowrap"
                                >
                                  Validar y Reactivar
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleReviewProof(proof.id, 'Rechazado')}
                                  className="rounded-md border border-rose-500/40 bg-rose-950/40 px-2.5 py-1 text-xs text-rose-300 hover:bg-rose-900/50 whitespace-nowrap"
                                >
                                  Rechazar
                                </button>
                              </div>
                            ) : (
                              <span className="font-mono text-[11px] text-slate-400">
                                Procesado ({proof.status})
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Invoices & Payments Grid */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
                    Facturas Emitidas ({invoices.length})
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 bg-slate-950/60 text-[11px] text-slate-400">
                          <th className="py-2.5 px-3">Factura / Cliente</th>
                          <th className="py-2.5 px-3">Vencimiento</th>
                          <th className="py-2.5 px-3 text-right">Total</th>
                          <th className="py-2.5 px-3">Estado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/70">
                        {invoices.map((inv: any) => (
                          <tr key={inv.id}>
                            <td className="py-2.5 px-3">
                              <div className="font-mono font-semibold text-slate-100">
                                {inv.invoice_number}
                              </div>
                              <div className="text-slate-400 text-[11px]">{inv.customer_name}</div>
                            </td>
                            <td className="py-2.5 px-3 font-mono tabular-nums text-slate-300">
                              {inv.due_date}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-100">
                              ${Number(inv.total).toFixed(2)}
                            </td>
                            <td className="py-2.5 px-3">
                              <span
                                className={
                                  inv.status === 'Pagada'
                                    ? 'text-emerald-400 font-medium'
                                    : inv.status === 'Vencida'
                                    ? 'text-rose-400 font-medium'
                                    : 'text-amber-400 font-medium'
                                }
                              >
                                {inv.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="rounded-lg border border-slate-800 bg-slate-900/70 overflow-hidden">
                  <div className="border-b border-slate-800 px-4 py-3 text-xs font-semibold text-slate-200">
                    Pagos Validados y Promesas de Pago Activas
                  </div>
                  <div className="p-4 space-y-3 text-xs">
                    {payments.map((p: any) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950 px-3.5 py-2.5"
                      >
                        <div>
                          <div className="font-mono font-semibold text-emerald-400">
                            {p.receipt_number} · ${Number(p.amount).toFixed(2)} ({p.method})
                          </div>
                          <div className="text-slate-300">
                            {p.customer_name} · Ref: <code className="text-slate-400">{p.reference}</code>
                          </div>
                        </div>
                        <span className="font-mono text-[11px] text-slate-400">{p.paid_at}</span>
                      </div>
                    ))}

                    <div className="pt-2 text-[11px] font-semibold text-slate-400">
                      Promesas de Pago Registradas:
                    </div>
                    {paymentPromises.map((pr: any) => (
                      <div
                        key={pr.id}
                        className="rounded-lg border border-sky-500/30 bg-sky-950/20 px-3.5 py-2.5"
                      >
                        <div className="flex justify-between font-medium text-sky-300">
                          <span>{pr.customer_name} ({pr.invoice_number})</span>
                          <span className="font-mono">Promesa: {pr.promised_date}</span>
                        </div>
                        <div className="text-slate-400 text-[11px] mt-0.5">{pr.comment}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODULE 6: PORTAL DEL CLIENTE (clientes.midominio.com) & WIFI
             ================================================================ */}
          {activeModule === 'customer_portal' && !portalCustomer && (
            <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-slate-800 bg-slate-900/60 py-20 text-center">
              <Globe className="h-8 w-8 text-slate-600" />
              <h2 className="text-base font-semibold text-slate-200">Sin clientes registrados</h2>
              <p className="max-w-md text-xs text-slate-400">
                El portal del cliente muestra únicamente suscriptores reales. Registra un cliente en «Clientes &amp;
                PPPoE» o importa tu base de clientes desde el Dashboard.
              </p>
            </div>
          )}
          {activeModule === 'customer_portal' && portalCustomer && (
            <div className="space-y-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between border-b border-slate-800 pb-5">
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight text-slate-100">
                    Portal de Autogestión del Cliente (`clientes.fibranet.do`)
                  </h1>
                  <p className="mt-1 text-sm text-slate-400">
                    Vista del suscriptor: estado del servicio, facturas, cuentas bancarias, reporte de pago y cambio de contraseña WiFi.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-400">Simular sesión como:</span>
                  <select
                    value={portalCustomerId}
                    onChange={(e) => setPortalCustomerId(Number(e.target.value))}
                    className="rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100"
                  >
                    {customers.map((c: any) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name} ({c.status})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Mandatory Suspended Banner per Specification #13 */}
              {(portalCustomer.status === 'Suspendido' || portalCustomer.status === 'Moroso') && (
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 rounded-xl border border-rose-500/50 bg-rose-950/50 p-5">
                  <div className="space-y-1">
                    <div className="text-base font-semibold text-rose-200">
                      Su servicio se encuentra suspendido debido a una factura pendiente.
                    </div>
                    <div className="text-xs text-rose-300/90">
                      Reporte su comprobante de transferencia o depósito para reactivar su conexión fibra/WISP de forma inmediata.
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      showToast(
                        'Comprobante registrado en estado «Pendiente de revisión».'
                      );
                      setActiveModule('billing_ocr');
                    }}
                    className="rounded-lg bg-rose-500 px-4 py-2.5 text-xs font-semibold text-white hover:bg-rose-400 transition-colors whitespace-nowrap"
                  >
                    Reportar pago
                  </button>
                </div>
              )}

              <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-2 text-xs">
                  <div className="font-semibold text-slate-200 text-sm">Mi Servicio Contratado</div>
                  <div>Titular: <strong>{portalCustomer.first_name} {portalCustomer.last_name}</strong></div>
                  <div>Código Cliente: <code className="text-sky-400">{portalCustomer.customer_code}</code></div>
                  <div>Estado actual: <strong>{portalCustomer.status}</strong></div>
                  <div>IP / Equipo CPE: <code>{portalCustomer.ip_address}</code> ({portalCustomer.onu_serial})</div>
                  <div>Fecha de corte mensual: Día 5 de cada mes</div>
                </div>

                {/* Change WiFi SSID & Password Form (#14) */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-3 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-slate-200 text-sm">
                    <Wifi className="h-4 w-4 text-sky-400" />
                    Cambio de Nombre y Contraseña WiFi
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Nuevo Nombre de Red (SSID)</label>
                    <input
                      type="text"
                      value={wifiSsidInput}
                      onChange={(e) => setWifiSsidInput(e.target.value)}
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 mb-1">Nueva Contraseña WiFi (Mín. 8 caracteres)</label>
                    <input
                      type="password"
                      value={wifiPassInput}
                      onChange={(e) => setWifiPassInput(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-1.5 text-xs text-slate-100"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      showToast(
                        `Solicitud de cambio WiFi (${wifiSsidInput}) validada y registrada en auditoría.`
                      )
                    }
                    className="w-full rounded-lg bg-sky-500 px-3 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400"
                  >
                    Solicitar Cambio de WiFi
                  </button>
                </div>

                {/* Bank Accounts for Payment (#22) */}
                <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-2.5 text-xs">
                  <div className="font-semibold text-slate-200 text-sm">
                    Cuentas Bancarias Oficiales ISP
                  </div>
                  {bankAccounts.map((ba: any) => (
                    <div
                      key={ba.id}
                      className="rounded-lg border border-slate-800 bg-slate-950 p-3 space-y-0.5"
                    >
                      <div className="font-semibold text-sky-400">{ba.bank_name}</div>
                      <div className="font-mono text-slate-100">
                        Cuenta {ba.account_type}: {ba.account_number} ({ba.currency})
                      </div>
                      <div className="text-slate-400 text-[11px]">Titular: {ba.holder_name}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODULE 7: CONTROLLED AI ASSISTANT & RBAC AUDIT LOGS
             ================================================================ */}
          {activeModule === 'ai_audit' && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-slate-900/70 p-5 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div>
                    <h2 className="text-base font-semibold text-slate-100">
                      Asistente IA de Operaciones ISP (Function Calling Controlado)
                    </h2>
                    <p className="text-xs text-slate-400">
                      Consulta métricas autorizadas de clientes, facturas, pagos, inventario de red, MikroTik y OLT sin ejecutar SQL arbitrario.
                    </p>
                  </div>

                  {/* Quick Prompt Buttons */}
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      '¿Cuántos clientes están morosos o suspendidos?',
                      '¿Cuánto cobramos este mes y cuántos comprobantes faltan por revisar?',
                      'Muéstrame el resumen del inventario de red AP, CPE y OLT.',
                      '¿Cuál es el estado del MikroTik principal?',
                    ].map((sample) => (
                      <button
                        key={sample}
                        type="button"
                        onClick={() => handleAskAi(sample)}
                        className="rounded-md border border-slate-700 bg-slate-950 px-2.5 py-1 text-[11px] text-slate-300 hover:border-sky-500/50 hover:text-sky-300 transition-colors"
                      >
                        {sample}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3 max-h-[380px] overflow-y-auto pr-1">
                    {aiHistory.map((m, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg p-3.5 text-xs leading-relaxed ${
                          m.role === 'user'
                            ? 'bg-sky-500/15 border border-sky-500/30 text-sky-100 ml-8'
                            : 'bg-slate-950 border border-slate-800 text-slate-200 mr-4'
                        }`}
                      >
                        <div className="whitespace-pre-line">{m.text}</div>
                        {m.tools && (
                          <div className="mt-2 pt-2 border-t border-slate-800/80 font-mono text-[10px] text-slate-400">
                            Funciones invocadas: {m.tools.join(' · ')}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAskAi();
                  }}
                  className="flex gap-2 pt-2 border-t border-slate-800"
                >
                  <input
                    type="text"
                    value={aiPrompt}
                    onChange={(e) => setAiPrompt(e.target.value)}
                    placeholder="Ej: ¿Qué clientes tienen facturas vencidas o qué CPE tiene señal baja?"
                    className="flex-1 rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-100"
                  />
                  <button
                    type="submit"
                    disabled={aiLoading}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500 px-4 py-2 text-xs font-semibold text-slate-950 hover:bg-sky-400 disabled:opacity-50"
                  >
                    <Send className="h-3.5 w-3.5" />
                    {aiLoading ? 'Consultando...' : 'Consultar'}
                  </button>
                </form>
              </div>

              {/* Complete RBAC Audit Logs (#24) */}
              <div className="lg:col-span-6 rounded-lg border border-slate-800 bg-slate-900/70 p-5 space-y-3">
                <div>
                  <h2 className="text-base font-semibold text-slate-100">
                    Bitácora de Auditoría e Historial de Operaciones (`audit_logs`)
                  </h2>
                  <p className="text-xs text-slate-400">
                    Registro inmutable de altas en inventario de red, cortes MikroTik, pagos y comprobantes, y ejecuciones CRON.
                  </p>
                </div>

                <div className="space-y-2 max-h-[470px] overflow-y-auto pr-1">
                  {auditLogs.map((log: any) => (
                    <div
                      key={log.id}
                      className="rounded-lg border border-slate-800 bg-slate-950 p-3 text-xs space-y-1"
                    >
                      <div className="flex items-center justify-between font-mono text-[11px]">
                        <span className="text-sky-400 font-semibold">
                          [{log.action}] {log.module} · {log.record_id}
                        </span>
                        <span className="text-slate-500">{log.created_at}</span>
                      </div>
                      <div className="text-slate-200">{log.details}</div>
                      <div className="font-mono text-[10px] text-slate-500">
                        Usuario: {log.user_name} · IP: {log.ip_address}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* ================================================================
              MODULE 8: PHP 8.2 + MYSQL 8 SOURCE CODE & MIGRATIONS VIEWER
             ================================================================ */}
          {activeModule === 'php_code' && <PhpSourceViewer />}

          {/* ================================================================
              MÓDULOS METADATA-DRIVEN (Clientes, Finanzas, Sistema, 
              Soporte Técnico, Almacén, Staff, Ajustes y Mi empresa)
             ================================================================ */}
          {activeModule === 'data:olts' && (
            <OltModule key="olts" onToast={showToast} onDataChanged={loadBootstrap} />
          )}
          {activeModule.startsWith('data:') && activeModule !== 'data:olts' && (
            <GenericModule
              key={activeModule}
              moduleKey={activeModule.slice(5)}
              onToast={showToast}
              onDataChanged={loadBootstrap}
              renderRowActions={
                activeModule === 'data:tickets'
                  ? (row, refresh) => <TicketReply ticket={row} onToast={showToast} onDone={refresh} />
                  : undefined
              }
            />
          )}

          {/* Fase 3: Dashboard financiero y contable */}
          {activeModule === 'finance_dashboard' && <FinanceDashboard onToast={showToast} />}

          {/* Estadísticas de clientes */}
          {activeModule === 'customer_stats' && <CustomerStats onToast={showToast} />}

          {/* Fase 4: Herramientas de router RouterOS */}
          {activeModule === 'router_tools' && <RouterTools routers={routers} onToast={showToast} />}

          {/* Fase 5: Mi empresa */}
          {activeModule === 'company_profile' && (
            <CompanyProfile isp={data?.isps?.[0]} onToast={showToast} onSaved={loadBootstrap} />
          )}

          {/* Fase 3: Contabilidad (Estado de Resultados + Balance General) */}
          {activeModule === 'accounting' && <AccountingDashboard onToast={showToast} />}

          {/* Fase 4: Calculadora / Planificador IPv6 */}
          {activeModule === 'ipv6_calculator' && <IPv6Calculator onToast={showToast} />}

          {/* Fase 5: Vista previa de Avisos en Pantalla */}
          {activeModule === 'screen_notice_preview' && <ScreenNoticePreview onToast={showToast} />}

          {/* Fase 5: Documentación de la API pública */}
          {activeModule === 'api_docs' && <ApiDocs onToast={showToast} />}
        </main>
      </div>

      {/* Modal: New Customer + Auto-CPE in Network Inventory */}
      {isNewCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-xs">
          <div className="w-full max-w-xl rounded-xl border border-slate-800 bg-slate-900 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
              <h2 className="text-base font-semibold text-slate-100">
                Registrar Nuevo Cliente + Secreto PPPoE + CPE en Inventario
              </h2>
              <button
                type="button"
                onClick={() => setIsNewCustomerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreateCustomer} className="p-6 space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Nombres *</label>
                  <input
                    type="text"
                    required
                    value={newCustForm.first_name}
                    onChange={(e) => setNewCustForm({ ...newCustForm, first_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Apellidos *</label>
                  <input
                    type="text"
                    required
                    value={newCustForm.last_name}
                    onChange={(e) => setNewCustForm({ ...newCustForm, last_name: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Cédula / Documento *</label>
                  <input
                    type="text"
                    required
                    value={newCustForm.document_id}
                    onChange={(e) =>
                      setNewCustForm({ ...newCustForm, document_id: e.target.value })
                    }
                    placeholder="001-0000000-0"
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Teléfono / WhatsApp *</label>
                  <input
                    type="text"
                    required
                    value={newCustForm.phone}
                    onChange={(e) => setNewCustForm({ ...newCustForm, phone: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1">Dirección Física *</label>
                <input
                  type="text"
                  required
                  value={newCustForm.address}
                  onChange={(e) => setNewCustForm({ ...newCustForm, address: e.target.value })}
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-slate-100"
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1">Usuario PPPoE *</label>
                  <input
                    type="text"
                    required
                    value={newCustForm.pppoe_user}
                    onChange={(e) => setNewCustForm({ ...newCustForm, pppoe_user: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Latitud GPS</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={newCustForm.gps_lat}
                    onChange={(e) => setNewCustForm({ ...newCustForm, gps_lat: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1">Longitud GPS</label>
                  <input
                    type="number"
                    step="0.000001"
                    value={newCustForm.gps_lng}
                    onChange={(e) => setNewCustForm({ ...newCustForm, gps_lng: e.target.value })}
                    className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-slate-100"
                  />
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsNewCustomerOpen(false)}
                  className="rounded-lg border border-slate-700 bg-slate-950 px-4 py-2 text-slate-300"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="rounded-lg bg-sky-500 px-4 py-2 font-semibold text-slate-950 hover:bg-sky-400"
                >
                  Crear Cliente y CPE en Mapa
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
