# NetCore ISP — Sistema Integral de Gestión WISP & FTTH (PHP 8.2+ & MySQL 8+)

Sistema profesional Multi-Tenant para Proveedores de Servicios de Internet (WISP y FTTH), diseñado con arquitectura MVC limpia, PDO con consultas preparadas, control de acceso basado en roles (RBAC), integración real con MikroTik RouterOS API, abstracción de drivers para OLT/FTTH, WhatsApp, Pasarelas de Pago, OCR de comprobantes, Asistente IA con funciones controladas y **Módulo de Inventario de Red con Mapa GIS (Leaflet / OpenStreetMap)**.

---

## 1. Análisis de Arquitectura y Estructura de Carpetas

```
/
├── app/
│   ├── Core/
│   │   └── Database.php                    # Singleton PDO MySQL 8+ con UTF8MB4 y Prepared Statements
│   ├── Controllers/
│   │   └── NetworkInventoryController.php  # Controlador MVC y API REST para AP, CPE, OLT y Routers
│   ├── Models/
│   │   └── NetworkDevice.php               # Modelo PDO con filtros multicriterio, validación MAC/IP/GPS
│   ├── Drivers/
│   │   ├── Contracts/
│   │   │   └── IspContracts.php            # MikrotikDriverInterface, OLTDriverInterface, WhatsAppProviderInterface, PaymentGatewayInterface
│   │   └── Mikrotik/
│   │       └── RouterOSApiDriver.php       # Cliente de sockets TCP/SSL para MikroTik RouterOS API (8728/8729)
│   └── Services/
│       └── BillingLifecycleService.php     # Flujo Facturación -> Vencimiento -> Suspensión MikroTik -> Pago -> Reactivación
├── database/
│   └── migrations/
│       ├── 001_full_isp_schema.sql         # Esquema MySQL 8+ normalizado (35+ tablas con FK, índices, DECIMAL)
│       └── 002_network_inventory.sql       # Tabla unificada network_inventory (AP, CPE, OLT, Router, PTP, Switch) + Seed
├── resources/
│   └── views/
│       └── network/
│           └── inventory.php               # Vista responsive con tabla dinámica AJAX y mapa Leaflet/OpenStreetMap
├── artisan                                 # CLI para tareas CRON (invoices:generate, customers:suspend, mikrotik:sync, etc.)
├── server.ts                               # Servidor Full-Stack API REST + Motor de persistencia + Proxy IA/Socket en vivo
└── .env.example                            # Variables de entorno documentadas sin secretos expuestos
```

---

## 2. Módulo de Inventario de Red y Mapa GIS (Leaflet / OpenStreetMap)

El módulo de inventario de red (`network_inventory`) permite registrar, buscar, auditar y geolocalizar:
- **Access Points (AP)**: Ubiquiti Rocket Prism, Mimosa A5c, Cambium ePMP, MikroTik mANTBox (frecuencia MHz, banda 2.4/5/6/60 GHz, ancho de canal, SSID, potencia dBm, torre/nodo).
- **Customer Premises Equipment (CPE)**: Antenas receptoras y ONUs/Routers domiciliarios vinculados directamente a un `customer_id`, y enlazados a un `parent_device_id` (AP u OLT).
- **OLTs FTTH**: Equipos de cabecera GPON/EPON (ZTE C320/C300, Huawei MA5800, VSOL, FiberHome) con información de potencia óptica Tx dBm, slots/puertos PON y ubicación en rack/nodo.
- **Routers de Borde / Core**: Equipos MikroTik CCR/RB con IP de gestión, MAC, versión de RouterOS y ubicación GPS.

### Criterios de Búsqueda Soportados (`GET /api/v1/network-inventory`)
- `search`: Búsqueda instantánea por Nombre, Código, Marca, Modelo, Dirección MAC, Dirección IP, SSID, Ubicación física o Nombre del Cliente asociado.
- `device_type`: `AP`, `CPE`, `OLT`, `Router`, `PTP`, `Switch`.
- `brand`: `Ubiquiti`, `MikroTik`, `Mimosa`, `Cambium`, `ZTE`, `Huawei`, `VSOL`, `TP-Link`.
- `frequency_band`: `2.4 GHz`, `5 GHz`, `6 GHz`, `60 GHz`, `Fibra Óptica GPON`, `Fibra / 10GbE`.
- `status`: `online`, `warning`, `offline`, `maintenance`.
- `customer_id`: Filtra los CPEs/equipos asignados a un cliente específico.

---

## 3. Flujo de Facturación → Vencimiento → Suspensión → Pago → Reactivación

1. **Generación (`php artisan invoices:generate`)**: Crea facturas mensuales para clientes en estado `Activo` usando tarifas `DECIMAL(12,2)`.
2. **Detección de Vencimiento (`php artisan invoices:check-overdue`)**: Marca como `Vencida` toda factura impaga tras su `due_date`.
3. **Suspensión Automática (`php artisan customers:suspend`)**:
   - Verifica periodo de gracia y que el cliente no tenga una `payment_promise` en estado `Pendiente` vigente.
   - Cambia el cliente a `Moroso`/`Suspendido`.
   - Conecta por API a MikroTik (`RouterOSApiDriver`), asigna el perfil `CORTADOS_MOROSOS` / address-list `MOROSOS_ISP` y reinicia la sesión PPPoE activa.
   - Registra el evento en `audit_logs` con `old_values` y `new_values`.
   - Envía notificación de corte por WhatsApp (`WhatsAppProviderInterface`).
4. **Recepción de Pago / OCR y Reactivación (`php artisan customers:reactivate`)**:
   - Si el comprobante llega por WhatsApp/Portal, pasa por OCR quedando en estado `Pendiente de revisión`.
   - Al validar el pago, la factura pasa a `Pagada`, el cliente a `Activo`, se restaura su perfil original en MikroTik, se registra en auditoría y se envía recibo por WhatsApp.

---

## 4. Configuración de Tareas CRON en Linux VPS

```cron
# Generar facturas el día 1 de cada mes a las 00:05
5 0 1 * * /usr/bin/php /var/www/netcore-isp/artisan invoices:generate >> /var/www/netcore-isp/storage/logs/cron.log 2>&1

# Verificar facturas vencidas todos los días a las 01:00
0 1 * * * /usr/bin/php /var/www/netcore-isp/artisan invoices:check-overdue >> /var/www/netcore-isp/storage/logs/cron.log 2>&1

# Ejecutar cortes automáticos a las 02:00 AM
0 2 * * * /usr/bin/php /var/www/netcore-isp/artisan customers:suspend >> /var/www/netcore-isp/storage/logs/cron.log 2>&1

# Sincronizar estado de MikroTik y niveles ópticos OLT cada 5 minutos
*/5 * * * * /usr/bin/php /var/www/netcore-isp/artisan mikrotik:sync >> /var/www/netcore-isp/storage/logs/cron.log 2>&1
*/10 * * * * /usr/bin/php /var/www/netcore-isp/artisan olt:sync >> /var/www/netcore-isp/storage/logs/cron.log 2>&1
```

---

## 5. Ejecución local (Demo Full-Stack: Node 20+ / React 19 + API Express)

El repositorio incluye además una demo funcional ejecutable del sistema completo (interfaz React + API REST + motor de persistencia en `storage/isp_database.json`), útil para revisar la UX de todos los módulos sin desplegar MySQL ni MikroTik reales.

### Requisitos
- Node.js 20 o superior (probado con Node 24)
- npm 10+

### Instalación y arranque

```bash
# 1. Instalar dependencias
npm install

# 2. (Opcional) Configurar variables de entorno
cp .env.example .env

# 3. Modo desarrollo (Vite HMR + API en el mismo puerto)
npm run dev
# -> http://localhost:3000

# 4. Modo producción (compila y sirve dist/)
npm run build
npm run start
```

### Scripts disponibles (`package.json`)

| Script | Descripción |
| --- | --- |
| `npm run dev` | Servidor Full-Stack en desarrollo (Vite middleware + API) en el puerto 3000. |
| `npm run build` | Compila el frontend React a `dist/`. |
| `npm run start` | Arranca el servidor (con `NODE_ENV=production` sirve `dist/`). |
| `npm run preview` | Previsualiza el build de Vite. |
| `npm run lint` | Verificación de tipos TypeScript (`tsc --noEmit`). |
| `npm run clean` | Elimina `dist/` y artefactos de build. |

### Endpoints principales de la API REST

| Método | Ruta | Descripción |
| --- | --- | --- |
| GET | `/api/v1/bootstrap?isp_id=1` | Carga inicial: ISP, planes, clientes, inventario, facturas, pagos, tickets y auditoría. |
| GET | `/api/v1/network-inventory` | Inventario de red con filtros `search`, `device_type`, `brand`, `frequency_band`, `status`, `customer_id`. |
| POST/PUT/DELETE | `/api/v1/network-inventory[/:id]` | Alta, edición y baja de dispositivos (valida MAC, IPv4 y GPS). |
| POST | `/api/v1/network-inventory/:id/ping` | Diagnóstico TCP/telemetría del equipo. |
| POST | `/api/v1/customers` | Alta de cliente + secreto PPPoE + CPE en el inventario. |
| POST | `/api/v1/customers/:id/toggle-status` | Corte / reactivación del servicio (sincroniza CPE y auditoría). |
| POST | `/api/v1/payment-proofs/:id/review` | Validación OCR: marca factura pagada y reactiva el servicio. |
| POST | `/api/v1/cron/run` | Ejecuta tareas equivalentes a `php artisan` desde la interfaz. |
| POST | `/api/v1/ai/chat` | Asistente IA con funciones controladas de solo lectura (Gemini; modo determinista si no hay API key). |
| GET | `/api/v1/php-source` | Devuelve el código fuente PHP/SQL del proyecto para el visor integrado. |

> **Nota:** si no se define `GEMINI_API_KEY`, el Asistente IA responde con un reporte determinista construido con las mismas funciones controladas (sin acceso SQL arbitrario).

---

## 6. Datos reales (sin datos de demostración) e Importación

La aplicación **ya no incluye datos de ejemplo/inventados**. Al primer arranque la base queda vacía y solo existe el *tenant* ISP base (definido por variables de entorno). Todo lo demás se llena con datos reales:

- **Registro manual** desde la interfaz (Clientes, Inventario de Red, etc.).
- **Importación masiva** desde el Dashboard → tarjeta «Importar datos reales (JSON / CSV)».
- **Dispositivos**: la prueba de conectividad (`/api/v1/network-inventory/:id/ping`) es un sondeo TCP real; si el equipo no responde, se informa honestamente en lugar de simular latencia.
- **Tareas CRON** (`/api/v1/cron/run`): `invoices:generate`, `invoices:check-overdue` y `customers:suspend` operan sobre tus datos reales; `mikrotik:sync` y `olt:sync` reportan cuántos equipos tienes configurados (no cifras simuladas).

### Formato JSON (varias secciones a la vez)

`POST /api/v1/import` con cuerpo JSON. Se admiten las secciones: `isps`, `plans`, `customers`, `network_inventory`, `routers`, `olts`, `invoices`, `payments`, `payment_proofs`, `payment_promises`, `tickets`, `bank_accounts`.

```json
{
  "plans": [
    { "code": "PLN-50", "name": "Hogar 50 Mbps", "download_mbps": 50, "upload_mbps": 25, "price_monthly": 30, "vlan_id": 110 }
  ],
  "customers": [
    { "customer_code": "CLI-00001", "first_name": "Ana", "last_name": "Díaz", "document_id": "001-0000000-1", "whatsapp": "+18090000001", "sector": "Centro", "gps_lat": 18.48, "gps_lng": -69.91, "status": "Activo", "plan_id": 1 }
  ],
  "network_inventory": [
    { "device_code": "CPE-0001", "name": "CPE Ana Díaz", "device_type": "CPE", "brand": "Ubiquiti", "model": "LiteBeam", "mac_address": "78:8A:20:11:22:33", "ip_address": "10.20.40.200", "gps_lat": 18.48, "gps_lng": -69.91, "status": "online", "customer_id": 1 }
  ]
}
```

### Formato CSV (una entidad por archivo)

`POST /api/v1/import` con cuerpo `{ "entity": "customers", "content": "<texto csv>" }`.
Descarga la plantilla de cabeceras con `GET /api/v1/import/template?entity=customers` (entidades: `customers`, `plans`, `network_inventory`, `routers`, `olts`, `invoices`, `payments`, `bank_accounts`).

### Reset

Para vaciar la base y volver al estado inicial (sin datos) basta con eliminar el archivo `storage/isp_database.json`; se regenera vacío en la siguiente petición.

### Integración con MySQL 8 real y equipos reales (MikroTik / OLT)

El backend PHP incluido (`app/`, `database/migrations/`) es el que corre sobre MySQL 8 en el VPS. Para que **esta** interfaz lea directamente de MySQL en lugar del almacén local, o para que la telemetría (PPPoE, ONUs, señal óptica) se consulte **en vivo** a tus equipos MikroTik RouterOS / OLT por API y SNMP, se requieren las credenciales/host reales (no disponibles en este entorno). Con esos datos se activa el adaptador correspondiente sin cambiar la interfaz.
