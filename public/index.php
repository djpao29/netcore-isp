<?php
declare(strict_types=1);

/**
 * NetCore ISP — Front Controller (PHP 8.2 + MySQL, XAMPP / cPanel)
 *
 * - Sirve la API JSON del panel (/api/v1/...) usando el motor CRUD
 *   metadata-driven (misma definición que el panel React).
 * - Sirve la interfaz del panel (app/Views/app.php) para el resto de rutas.
 */

require __DIR__ . '/../app/Support/bootstrap.php';

use App\Core\Auth;
use App\Core\Config;
use App\Core\Cron;
use App\Core\Database;
use App\Core\Mikrotik;
use App\Core\ModuleRegistry;
use App\Core\Olt;
use App\Core\Modules;
use App\Core\Routers;

apply_app_config();

$scriptDir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
$uri       = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
if ($scriptDir !== '' && str_starts_with($uri, $scriptDir)) {
    $uri = substr($uri, strlen($scriptDir));
}
$uri    = '/' . trim($uri, '/');
$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');

// Compatibilidad con hosting que no permite PUT/DELETE directos.
if ($method === 'POST' && isset($_GET['_method'])) {
    $method = strtoupper((string) $_GET['_method']);
}

// Sin instalar: el panel redirige al asistente; la API responde 503 JSON.
if (!Config::isInstalled()) {
    if (preg_match('#(^|/)api(/|$)#', $uri) === 1) {
        json_response(['status' => 'error', 'message' => 'La aplicación no está instalada.'], 503);
    }
    header('Location: ' . ($scriptDir === '' ? '' : $scriptDir) . '/install.php');
    exit;
}

// Producto del panel: no es API.
if (!str_starts_with($uri, '/api/')) {
    require __DIR__ . '/../app/Views/app.php';
    exit;
}

$pdo = Database::getConnection();
Auth::start();

/** Segmentos de /api/v1/... */
$segments = array_values(array_filter(explode('/', $uri), static fn ($s) => $s !== ''));
// $segments[0]='api' [1]='v1' ...
$resource = $segments[2] ?? '';
$id       = $segments[3] ?? null;
$sub      = $segments[4] ?? null;

$input = json_input();

// ---------------------------------------------------------------- Autenticación
if ($resource === 'auth') {
    $action = $id;
    if ($action === 'login' && $method === 'POST') {
        $email    = trim((string) ($input['email'] ?? ''));
        $password = (string) ($input['password'] ?? '');
        if ($email === '' || $password === '') {
            json_response(['status' => 'error', 'message' => 'Ingresa correo y contraseña.'], 422);
        }
        if (!Auth::attempt($email, $password)) {
            json_response(['status' => 'error', 'message' => 'Credenciales inválidas.'], 401);
        }
        json_response(['status' => 'success', 'user' => Auth::user(), 'csrf_token' => csrf_token()]);
    }
    if ($action === 'logout') {
        Auth::logout();
        json_response(['status' => 'success']);
    }
    if ($action === 'me') {
        json_response(['status' => Auth::check() ? 'success' : 'error', 'user' => Auth::user(), 'csrf_token' => csrf_token()]);
    }
    json_response(['status' => 'error', 'message' => 'Ruta de autenticación no encontrada.'], 404);
}

// ---------------------------------------------------------------- Autenticación del colector on-prem (token)
// El colector envía datos por HTTPS saliente con un token de larga duración.
// Esto evita depender de sesión+CSRF en un proceso desatendido.
$collectorToken = trim((string) Config::get('security.collector_token', ''));
$providedToken  = trim((string) ($_SERVER['HTTP_X_COLLECTOR_TOKEN'] ?? ''));
$isCollector    = ($collectorToken !== '' && $providedToken !== '' && hash_equals($collectorToken, $providedToken));

// A partir de aquí se requiere sesión (o token de colector válido).
if (!Auth::check() && !$isCollector) {
    json_response(['status' => 'error', 'message' => 'Sesión no iniciada.'], 401);
}

// Protección CSRF en todas las operaciones que modifican datos (excepto colector).
if (in_array($method, ['POST', 'PUT', 'PATCH', 'DELETE'], true) && !csrf_check() && !$isCollector) {
    json_response(['status' => 'error', 'message' => 'Token CSRF inválido o ausente.'], 419);
}

$ispId = Auth::check() ? Auth::ispId() : (int) Config::get('security.collector_isp_id', 1);
if ($ispId <= 0) $ispId = 1;
$modules = new Modules($pdo, $ispId);

// ---------------------------------------------------------------- Metadatos
if ($resource === 'modules' && $method === 'GET') {
    json_response([
        'status'  => 'success',
        'groups'  => ModuleRegistry::groups(),
        'modules' => ModuleRegistry::modules(),
    ]);
}

// ---------------------------------------------------------------- Bootstrap
if ($resource === 'bootstrap' && $method === 'GET') {
    $counts = [];
    $stmt   = $pdo->prepare('SELECT module_key, COUNT(*) AS total FROM module_records WHERE isp_id = ? GROUP BY module_key');
    $stmt->execute([Auth::ispId()]);
    foreach ($stmt->fetchAll() as $row) {
        $counts[$row['module_key']] = (int) $row['total'];
    }

    $isp = $pdo->query('SELECT * FROM isps ORDER BY id ASC LIMIT 1')->fetch() ?: null;

    json_response([
        'status'   => 'success',
        'isp'      => $isp,
        'user'     => Auth::user(),
        'groups'   => ModuleRegistry::groups(),
        'modules'  => ModuleRegistry::modules(),
        'counts'   => $counts,
    ]);
}

// ---------------------------------------------------------------- Auditoría
if ($resource === 'audit' && $method === 'GET') {
    $stmt = $pdo->prepare('SELECT * FROM audit_events WHERE isp_id = ? ORDER BY id DESC LIMIT 200');
    $stmt->execute([Auth::ispId()]);
    json_response(['status' => 'success', 'rows' => $stmt->fetchAll()]);
}

// ---------------------------------------------------------------- Estadísticas de clientes
if ($resource === 'customer-stats' && $method === 'GET') {
    $customers = $modules->list('customers', []);
    $byStatus  = [];
    $bySector  = [];
    foreach ($customers as $c) {
        $status = (string) ($c['status'] ?? 'Sin estado');
        $sector = (string) ($c['sector'] ?? 'Sin sector');
        $byStatus[$status] = ($byStatus[$status] ?? 0) + 1;
        $bySector[$sector] = ($bySector[$sector] ?? 0) + 1;
    }
    json_response([
        'status'    => 'success',
        'total'     => count($customers),
        'by_status' => $byStatus,
        'by_sector' => $bySector,
    ]);
}

// ---------------------------------------------------------------- Receptor de traps SNMP (reenviados por colector on-prem)
// El SaaS no escucha UDP 162 directamente: un colector on-prem recibe el trap
// y lo reenv�a por HTTPS a este endpoint, normalizado.
if ($resource === 'traps' && $method === 'POST') {
    $ip = trim((string) ($input['source_ip'] ?? ''));
    $trapOid = trim((string) ($input['trap_oid'] ?? ''));
    $severity = (string) ($input['severity'] ?? 'warning');
    if (!in_array($severity, ['critical', 'major', 'minor', 'warning', 'info'], true)) $severity = 'warning';
    $type = trim((string) ($input['type'] ?? ''));
    $desc = trim((string) ($input['description'] ?? ''));
    $receivedAt = trim((string) ($input['received_at'] ?? '')) ?: date('Y-m-d H:i:s');

    $oltName = '';
    $oltId = null;
    foreach ($modules->list('olts', []) as $o) {
        if (trim((string) ($o['ip_address'] ?? '')) === $ip) {
            $oltId = (int) ($o['id'] ?? 0);
            $oltName = (string) ($o['name'] ?? '');
            break;
        }
    }

    $row = $modules->create('olt_alarms', [
        'olt_id' => $oltId,
        'olt_name' => $oltName ?: ($ip ?: 'desconocida'),
        'severity' => $severity,
        'type' => $type ?: 'trap',
        'description' => $desc ?: "Trap SNMP recibido desde {$ip}",
        'source_ip' => $ip,
        'trap_oid' => $trapOid,
        'received_at' => $receivedAt,
        'status' => 'Activa',
    ]);

    $logDir = BASE_PATH . '/storage/logs';
    if (!is_dir($logDir)) { @mkdir($logDir, 0775, true); }
    $logLine = date('c') . ' TRAP received ip=' . $ip . ' olt=' . ($oltName ?: '-') . ' severity=' . $severity . ' type=' . $type . ' oid=' . $trapOid . "\n";
    @file_put_contents($logDir . '/olt_traps.log', $logLine, FILE_APPEND | LOCK_EX);

    json_response(['status' => 'success', 'message' => 'Trap registrado.', 'row' => $row], 201);
}

// ---------------------------------------------------------------- Snapshot del colector on-prem (polling + ONUs + alarmas)
// Recibe un ciclo de polling completo del colector y lo persiste en el SaaS.
if ($resource === 'collector' && $id === 'snapshot' && $method === 'POST') {
    if (!$isCollector && !Auth::check()) {
        json_response(['status' => 'error', 'message' => 'No autorizado.'], 401);
    }
    $poll = (array) ($input['poll_result'] ?? []);
    $raw  = (array) ($poll['raw'] ?? []);
    $oltPayload = (array) ($raw['olt'] ?? []);
    $oltId = (int) ($input['olt_id'] ?? ($oltPayload['id'] ?? 0));
    $oltName = trim((string) ($oltPayload['name'] ?? ''));

    // Resolver OLT por id o IP
    $oltRow = null;
    if ($oltId > 0) {
        $oltRow = $modules->find('olts', $oltId);
    }
    if ($oltRow === null && $oltName === '') {
        $ip = trim((string) ($oltPayload['ip_address'] ?? ''));
        foreach ($modules->list('olts', []) as $o) {
            if (trim((string) ($o['ip_address'] ?? '')) === $ip) { $oltRow = $o; break; }
        }
    }
    if ($oltRow !== null) {
        $oltId = (int) ($oltRow['id'] ?? $oltId);
        if ($oltName === '') $oltName = (string) ($oltRow['name'] ?? '');
        // Actualizar estado del OLT
        $modules->update('olts', $oltId, [
            'status' => ($raw['status'] ?? 'Conectado') === 'online' ? 'Conectado' : 'Sin respuesta',
            'last_poll_at' => date('Y-m-d H:i:s'),
        ]);
    } elseif ($oltName === '') {
        $oltName = 'OLT desconocida';
    }

    // Persistir m�trica (snapshot)
    $ponCount = count((array) ($raw['pon_walk'] ?? []));
$ponPortsIn = (array) ($poll['pon_ports'] ?? []);
if ($ponCount === 0 && !empty($ponPortsIn)) $ponCount = count($ponPortsIn);
    // pon_count / onu_count se env�an expl�citamente si vienen
    $ponCount = (int) ($poll['pon_count'] ?? $ponCount);
    $onuCount = (int) ($poll['onu_count'] ?? 0);
    $onusIn = (array) ($poll['onus'] ?? []);
    if ($onuCount === 0) $onuCount = count($onusIn);
    $metricsRow = $modules->create('olt_metrics', [
        'olt_id'         => $oltId > 0 ? $oltId : null,
        'olt_name'       => $oltName,
        'ok'             => (bool) ($poll['ok'] ?? false),
        'latency_ms'     => (int) ($poll['latency_ms'] ?? 0),
        'error'          => (string) ($poll['error'] ?? ''),
        'uptime_seconds' => (int) ($raw['uptime_seconds'] ?? 0),
        'pon_count'      => $ponCount,
        'onu_count'      => $onuCount,
        'polled_at'      => (string) ($poll['started_at'] ?? date('Y-m-d H:i:s')),
        'snapshot'       => json_encode($poll, JSON_UNESCAPED_UNICODE),
    ]);

    // Upsert de ONUs por serial
    $existingOnus = [];
    foreach ($modules->list('olt_onus', []) as $o) {
        if ((int) ($o['olt_id'] ?? 0) === $oltId) {
            $existingOnus[(string) ($o['serial'] ?? '')] = (int) ($o['id'] ?? 0);
        }
    }
    foreach ($onusIn as $onu) {
        $onu = (array) $onu;
        $serial = trim((string) ($onu['serial'] ?? ''));
        if ($serial === '') continue;
        $payload = [
            'olt_id'          => $oltId > 0 ? $oltId : null,
            'olt_name'        => $oltName,
            'pon_port'        => (int) ($onu['pon_port'] ?? 0),
            'index'           => (string) ($onu['index'] ?? ''),
            'serial'          => $serial,
            'mac'             => (string) ($onu['mac'] ?? ''),
            'model'           => (string) ($onu['model'] ?? ''),
            'admin_state'     => (string) ($onu['admin_state'] ?? 'active'),
            'oper_state'      => (string) ($onu['oper_state'] ?? 'unknown'),
            'rx_power_dbm'    => $onu['rx_power_dbm'] ?? null,
            'tx_power_dbm'    => $onu['tx_power_dbm'] ?? null,
            'distance_m'      => $onu['distance_m'] ?? null,
            'last_down_cause' => (string) ($onu['last_down_cause'] ?? ''),
            'last_seen'       => (string) ($onu['last_seen'] ?? date('Y-m-d H:i:s')),
        ];
        if (isset($existingOnus[$serial])) {
            $modules->update('olt_onus', $existingOnus[$serial], $payload);
        } else {
            $modules->create('olt_onus', $payload);
        }
    }

    // Alarmas embebidas -> olt_alarms
    foreach ((array) ($poll['alarms'] ?? []) as $al) {
        $al = (array) $al;
        $sev = (string) ($al['severity'] ?? 'warning');
        if (!in_array($sev, ['critical','major','minor','warning','info'], true)) $sev = 'warning';
        $modules->create('olt_alarms', [
            'olt_id'      => $oltId > 0 ? $oltId : null,
            'olt_name'    => $oltName,
            'severity'    => $sev,
            'type'        => (string) ($al['type'] ?? 'trap'),
            'description' => (string) ($al['description'] ?? ''),
            'source_ip'   => (string) ($al['source_ip'] ?? ''),
            'trap_oid'    => (string) ($al['trap_oid'] ?? ''),
            'received_at' => (string) ($al['received_at'] ?? date('Y-m-d H:i:s')),
            'status'      => (string) ($al['status'] ?? 'Activa'),
        ]);
    }

    json_response(['status' => 'success', 'message' => 'Snapshot registrado.', 'metric_id' => $metricsRow['id'] ?? null], 201);
}



// ---------------------------------------------------------------- Factura por cliente (generaci�n individual)
if ($resource === 'customers' && $id !== null && $sub === 'invoice' && $method === 'POST') {
    $customer = $modules->find('customers', (int) $id);
    if ($customer === null) {
        json_response(['status' => 'error', 'message' => 'Cliente no encontrado.'], 404);
    }

    $today = date('Y-m-d');
    $month = date('Y-m');
    $existing = null;
    foreach ($modules->list('invoices', []) as $inv) {
        if ((string) ($inv['customer_id'] ?? '') === (string) ($customer['id'] ?? '')
            && str_starts_with((string) ($inv['issue_date'] ?? ''), $month)) {
            $existing = $inv;
            break;
        }
    }
    if ($existing !== null) {
        json_response(['status' => 'success', 'message' => 'Ya existe una factura para este mes.', 'row' => $existing, 'created' => false]);
    }

    $plans = [];
    foreach ($modules->list('plans', []) as $p) {
        $plans[(string) ($p['id'] ?? '')] = $p;
    }
    $plan  = $plans[(string) ($customer['plan_id'] ?? '')] ?? null;
    $total = (float) ($plan['price_monthly'] ?? 0);

    $row = $modules->create('invoices', [
        'customer_id'   => $customer['id'] ?? null,
        'customer_name' => trim(((string) ($customer['first_name'] ?? '')) . ' ' . ((string) ($customer['last_name'] ?? ''))),
        'plan_name'     => (string) ($plan['name'] ?? ($customer['plan_name'] ?? 'Sin plan asignado')),
        'issue_date'    => $today,
        'due_date'      => date('Y-m-05'),
        'subtotal'      => $total,
        'tax_amount'    => 0,
        'total'         => $total,
        'status'        => 'Pendiente',
    ]);
    if (!empty($row['code'])) {
        $modules->update('invoices', (int) $row['id'], ['invoice_number' => $row['code']]);
        $row = $modules->find('invoices', (int) $row['id']) ?? $row;
    }

    json_response(['status' => 'success', 'message' => 'Factura generada.', 'row' => $row, 'created' => true], 201);
}


// ---------------------------------------------------------------- Routers (RouterOS real)
if ($resource === 'routers' && $id !== null && $sub !== null && $method === 'POST') {
    $router = $modules->find('routers', (int) $id);
    if ($router === null) {
        json_response(['status' => 'error', 'message' => 'Router no encontrado.'], 404);
    }
    if (trim((string) ($router['ip_address'] ?? '')) === '') {
        json_response(['status' => 'error', 'message' => "El router \"{$router['name']}\" no tiene IP de gestión configurada."], 422);
    }

    if ($sub === 'test') {
        $result = Mikrotik::test(Routers::creds($router));
        json_response(['status' => $result['ok'] ? 'success' : 'error', 'real' => true] + $result, $result['ok'] ? 200 : 502);
    }

    if ($sub === 'tool') {
        $tool = (string) ($input['tool'] ?? 'ping');
        try {
            $result = Mikrotik::runTool(Routers::creds($router), $tool, (string) $router['name']);
            $modules->appendAudit('ROUTER_TOOL', 'Router', (string) $router['name'], "Herramienta {$tool} ejecutada por API RouterOS.");
            json_response(['status' => 'success', 'real' => true, 'router' => $router['name']] + $result);
        } catch (\Throwable $e) {
            $modules->appendAudit('ROUTER_TOOL_ERROR', 'Router', (string) $router['name'], "Fallo {$tool}: " . $e->getMessage());
            json_response(['status' => 'error', 'real' => true, 'message' => $e->getMessage()], 502);
        }
    }
}
// ---------------------------------------------------------------- OLT (SNMP + Telnet)
if ($resource === 'olts' && $id !== null && $sub === 'test' && $method === 'POST') {
    $olt = $modules->find('olts', (int) $id);
    if ($olt === null) { json_response(['status' => 'error', 'message' => 'OLT no encontrado.'], 404); }
    $res = Olt::test(Olt::creds($olt));
    json_response(['status' => $res['ok'] ? 'success' : 'error', 'real' => true] + $res, $res['ok'] ? 200 : 502);
}

if ($resource === 'olts' && $id !== null && $sub === 'sync' && $method === 'POST') {
    $olt = $modules->find('olts', (int) $id);
    if ($olt === null) { json_response(['status' => 'error', 'message' => 'OLT no encontrado.'], 404); }
    $summary = Olt::syncOne(Olt::creds($olt), $modules, (int) $id);
    $modules->appendAudit('OLT_SYNC', 'OLT', (string) ($olt['name'] ?? $id), $summary);
    json_response(['status' => 'success', 'message' => $summary, 'output' => $summary]);
}

if ($resource === 'olts' && $id !== null && $sub === 'command' && $method === 'POST') {
    $olt = $modules->find('olts', (int) $id);
    if ($olt === null) { json_response(['status' => 'error', 'message' => 'OLT no encontrado.'], 404); }
    $command = (string) ($input['command'] ?? '');
    if ($command === '') { json_response(['status' => 'error', 'message' => 'Comando vac�o.'], 422); }
    try {
        $out = Olt::telnetCommand(Olt::creds($olt), $command, (string) ($input['prompt'] ?? '#'));
        $modules->appendAudit('OLT_COMMAND', 'OLT', (string) ($olt['name'] ?? $id), "Telnet: {$command}");
        json_response(['status' => 'success', 'real' => true, 'output' => $out]);
    } catch (\Throwable $e) {
        json_response(['status' => 'error', 'real' => true, 'message' => $e->getMessage()], 502);
    }
}


// ---------------------------------------------------------------- CRON / tareas
if ($resource === 'cron' && $id === 'run' && $method === 'POST') {
    $command = (string) ($input['command'] ?? '');
    $summary = Cron::run($command, $modules);
    $modules->appendAudit('CRON_EXEC', 'System/CLI', $command, $summary);
    json_response([
        'status'    => 'success',
        'command'   => $command,
        'timestamp' => date('c'),
        'output'    => "[CRON OK] php artisan {$command} -> {$summary}",
    ]);
}

// ---------------------------------------------------------------- CRUD genérico
// /api/v1/data/{module}          -> listar / crear
// /api/v1/data/{module}/{id}     -> actualizar / eliminar
// /api/v1/data/{module}/bulk     -> operaciones masivas
if ($resource === 'data') {
    $moduleKey = (string) $id;
    $rowId     = null; // id del REGISTRO (cuarto segmento)
    if ($sub !== null && ctype_digit((string) $sub)) {
        $rowId = (int) $sub;
    }

    try {
        if ($method === 'GET' && $sub === null && $moduleKey !== '') {
            $rows = $modules->list($moduleKey, $_GET);
            json_response(['status' => 'success', 'module' => $moduleKey, 'rows' => $rows, 'total' => count($rows)]);
        }

        if ($method === 'GET' && $rowId !== null) {
            $row = $modules->find($moduleKey, $rowId);
            if ($row === null) {
                json_response(['status' => 'error', 'message' => 'Registro no encontrado.'], 404);
            }
            json_response(['status' => 'success', 'module' => $moduleKey, 'row' => $row]);
        }

        if ($method === 'POST' && $sub === 'bulk') {
            $affected = $modules->bulk($moduleKey, (string) ($input['action'] ?? ''), (array) ($input['ids'] ?? []), (array) ($input['payload'] ?? []));
            json_response(['status' => 'success', 'message' => "Registros afectados: {$affected}."]);
        }

        if ($method === 'POST' && $sub === null) {
            $row = $modules->create($moduleKey, $input);

            // Al dar de alta un cliente activo/moroso, se le genera de inmediato
            // su primera factura y queda enrolado en la facturación mensual (CRON).
            $extra = [];
            if ($moduleKey === 'customers') {
                $status = (string) ($row['status'] ?? '');
                if ($status === 'Activo' || $status === 'Moroso') {
                    $today = date('Y-m-d');
                    $month = date('Y-m');
                    $existing = null;
                    foreach ($modules->list('invoices', []) as $inv) {
                        if ((string) ($inv['customer_id'] ?? '') === (string) ($row['id'] ?? '')
                            && str_starts_with((string) ($inv['issue_date'] ?? ''), $month)) {
                            $existing = $inv;
                            break;
                        }
                    }
                    if ($existing === null) {
                        $plans = [];
                        foreach ($modules->list('plans', []) as $p) {
                            $plans[(string) ($p['id'] ?? '')] = $p;
                        }
                        $plan  = $plans[(string) ($row['plan_id'] ?? '')] ?? null;
                        $total = (float) ($plan['price_monthly'] ?? 0);
                        $invRow = $modules->create('invoices', [
                            'customer_id'   => $row['id'] ?? null,
                            'customer_name' => trim(((string) ($row['first_name'] ?? '')) . ' ' . ((string) ($row['last_name'] ?? ''))),
                            'plan_name'     => (string) ($plan['name'] ?? ($row['plan_name'] ?? 'Sin plan asignado')),
                            'issue_date'    => $today,
                            'due_date'      => date('Y-m-05'),
                            'subtotal'      => $total,
                            'tax_amount'    => 0,
                            'total'         => $total,
                            'status'        => 'Pendiente',
                        ]);
                        if (!empty($invRow['code'])) {
                            $modules->update('invoices', (int) $invRow['id'], ['invoice_number' => $invRow['code']]);
                            $invRow = $modules->find('invoices', (int) $invRow['id']) ?? $invRow;
                        }
                        $extra['invoice'] = $invRow;
                        $extra['invoice_created'] = true;
                        $extra['message'] = 'Registro creado. Factura generada: ' . ($invRow['code'] ?? '');
                    } else {
                        $extra['invoice'] = $existing;
                        $extra['invoice_created'] = false;
                    }
                }
            }

            $payload = ['status' => 'success', 'message' => 'Registro creado.', 'row' => $row];
            if (!empty($extra)) {
                if (!empty($extra['message'])) { $payload['message'] = $extra['message']; }
                unset($extra['message']);
                $payload = array_merge($payload, $extra);
            }
            json_response($payload, 201);
        }

        if (($method === 'PUT' || $method === 'PATCH') && $rowId !== null) {
            $row = $modules->update($moduleKey, $rowId, $input);
            if ($row === null) {
                json_response(['status' => 'error', 'message' => 'Registro no encontrado.'], 404);
            }
            json_response(['status' => 'success', 'message' => 'Registro actualizado.', 'row' => $row]);
        }

        if ($method === 'DELETE' && $rowId !== null) {
            $ok = $modules->delete($moduleKey, $rowId);
            json_response(['status' => $ok ? 'success' : 'error', 'message' => $ok ? 'Registro eliminado.' : 'Registro no encontrado.'], $ok ? 200 : 404);
        }
    } catch (\Throwable $e) {
        $code = $e->getCode() >= 400 && $e->getCode() < 600 ? (int) $e->getCode() : 500;
        json_response(['status' => 'error', 'message' => $e->getMessage()], $code);
    }
}

json_response(['status' => 'error', 'message' => "Ruta no encontrada: {$method} {$uri}"], 404);
