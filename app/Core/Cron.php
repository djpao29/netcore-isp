<?php
declare(strict_types=1);

namespace App\Core;

use App\Drivers\Mikrotik\MikrotikTrafficDriver;
use App\Drivers\FreeRADIUS\FreeRadiusProvider;

/**
 * Tareas programadas del ciclo de facturación y corte.
 * Reutilizado por la ruta web /api/v1/cron/run y por cron.php (CLI / cPanel).
 */
final class Cron
{
    public static function run(string $command, Modules $modules): string
    {
        switch ($command) {
            case 'invoices:generate':
                return self::generateInvoices($modules);

            case 'invoices:check-overdue':
                return self::checkOverdue($modules);

            case 'customers:suspend':
                return self::suspendDelinquents($modules);

            case 'mikrotik:sync':
                return self::syncMikrotik($modules);

            case 'olt:sync':
                return self::syncOlts($modules);

            case 'simplequeue:sync':
                return self::syncSimpleQueues($modules);

            case 'pcq:sync':
                return self::syncPcq($modules);

            case 'freeradius:sync':
                return self::syncFreeRadius($modules);

            case 'olt:onu:sync':
                return self::syncOltOnus($modules);

            default:
                return "Comando {$command} finalizado.";
        }
    }

    private static function generateInvoices(Modules $modules): string
    {
        $today     = date('Y-m-d');
        $month     = date('Y-m');
        $customers = $modules->list('customers', []);
        $existing  = $modules->list('invoices', []);

        $plans = [];
        foreach ($modules->list('plans', []) as $p) {
            $plans[(string) ($p['id'] ?? '')] = $p;
        }

        $creadas = 0;
        foreach ($customers as $c) {
            $status = (string) ($c['status'] ?? '');
            if ($status !== 'Activo' && $status !== 'Moroso') {
                continue;
            }
            $already = false;
            foreach ($existing as $inv) {
                if ((string) ($inv['customer_id'] ?? '') === (string) ($c['id'] ?? '')
                    && str_starts_with((string) ($inv['issue_date'] ?? ''), $month)) {
                    $already = true;
                    break;
                }
            }
            if ($already) {
                continue;
            }
            $plan  = $plans[(string) ($c['plan_id'] ?? '')] ?? null;
            $total = (float) ($plan['price_monthly'] ?? 0);
            $modules->create('invoices', [
                'customer_id'   => $c['id'] ?? null,
                'customer_name' => trim(((string) ($c['first_name'] ?? '')) . ' ' . ((string) ($c['last_name'] ?? ''))),
                'plan_name'     => (string) ($plan['name'] ?? 'Sin plan asignado'),
                'issue_date'    => $today,
                'due_date'      => date('Y-m-05'),
                'subtotal'      => $total,
                'tax_amount'    => 0,
                'total'         => $total,
                'status'        => 'Pendiente',
            ]);
            $creadas++;
        }

        return "Facturas generadas: {$creadas}. Clientes evaluados: " . count($customers) . '.';
    }

    private static function checkOverdue(Modules $modules): string
    {
        $today  = date('Y-m-d');
        $marked = 0;
        foreach ($modules->list('invoices', []) as $inv) {
            if (($inv['status'] ?? '') === 'Pendiente'
                && ($inv['due_date'] ?? '') !== ''
                && (string) $inv['due_date'] < $today) {
                $modules->update('invoices', (int) $inv['id'], ['status' => 'Vencida']);
                $marked++;
            }
        }
        return "Facturas marcadas como Vencidas: {$marked}.";
    }

    private static function suspendDelinquents(Modules $modules): string
    {
        $invoices = $modules->list('invoices', []);
        $promises = $modules->list('payment_promises', []);
        $routers  = $modules->list('routers', []);

        $cortados = 0;
        $enRouter = 0;
        $fallos   = [];

        foreach ($modules->list('customers', []) as $c) {
            if (($c['status'] ?? '') === 'Suspendido') {
                continue;
            }
            $vencida = false;
            foreach ($invoices as $inv) {
                if ((string) ($inv['customer_id'] ?? '') === (string) ($c['id'] ?? '')
                    && ($inv['status'] ?? '') === 'Vencida') {
                    $vencida = true;
                    break;
                }
            }
            $promesa = false;
            foreach ($promises as $p) {
                if ((string) ($p['customer_id'] ?? '') === (string) ($c['id'] ?? '')
                    && ($p['status'] ?? '') === 'Pendiente') {
                    $promesa = true;
                    break;
                }
            }
            if (!$vencida || $promesa) {
                continue;
            }

            $modules->update('customers', (int) $c['id'], ['status' => 'Suspendido']);
            $cortados++;

            $router = null;
            foreach ($routers as $r) {
                if ((string) ($r['id'] ?? '') === (string) ($c['router_id'] ?? '')) {
                    $router = $r;
                    break;
                }
            }
            $router ??= ($routers[0] ?? null);
            if ($router === null || trim((string) ($router['ip_address'] ?? '')) === '' || empty($c['pppoe_user'])) {
                continue;
            }

            try {
                $res = Mikrotik::setPppoeEnabled(Routers::creds($router), (string) $c['pppoe_user'], false);
                if ($res['ok']) {
                    $enRouter++;
                } else {
                    $fallos[] = ((string) $c['pppoe_user']) . ': ' . $res['message'];
                }
            } catch (\Throwable $e) {
                $fallos[] = ((string) $c['pppoe_user']) . ': ' . $e->getMessage();
            }
        }

        return "Cortes en base de datos: {$cortados}. Cortes aplicados en RouterOS: {$enRouter}."
            . ($fallos !== [] ? ' Fallos: ' . implode('; ', array_slice($fallos, 0, 5)) : '');
    }

    private static function syncMikrotik(Modules $modules): string
    {
        $routers = $modules->list('routers', []);
        if ($routers === []) {
            return 'No hay routers MikroTik registrados.';
        }

        $lineas = [];
        foreach ($routers as $router) {
            $name = (string) ($router['name'] ?? 'router');
            if (trim((string) ($router['ip_address'] ?? '')) === '') {
                $lineas[] = "{$name}: sin IP de gestión";
                continue;
            }
            try {
                $res = Mikrotik::runTool(Routers::creds($router), 'ppp-active', $name);
                $modules->update('routers', (int) $router['id'], ['active_pppoe' => $res['rows'], 'status' => 'Conectado']);
                $lineas[] = "{$name}: {$res['rows']} sesión(es) PPPoE activas";
            } catch (\Throwable $e) {
                $modules->update('routers', (int) $router['id'], ['status' => 'Desconectado']);
                $lineas[] = "{$name}: error (" . $e->getMessage() . ')';
            }
        }

        return 'Sincronización real vía API RouterOS -> ' . implode(' | ', $lineas);
    }

    private static function syncOlts(Modules $modules): string
    {
        $olts = $modules->list('olts', []);
        if ($olts === []) {
            return 'No hay OLTs registrados.';
        }
        $lineas = [];
        foreach ($olts as $olt) {
            $id = (int) ($olt['id'] ?? 0);
            if ($id <= 0) continue;
            // Aislamiento por OLT: un fallo no afecta a los demás; reintentos con backoff.
            $attempts = 0;
            $maxAttempts = 3;
            $lastError = null;
            $summary = null;
            while ($attempts < $maxAttempts) {
                $attempts++;
                try {
                    $summary = Olt::syncOne(Olt::creds($olt), $modules, $id);
                    $lastError = null;
                    break;
                } catch (\Throwable $e) {
                    $lastError = $e->getMessage();
                    if ($attempts < $maxAttempts) {
                        usleep(500000 * $attempts); // backoff: 0.5s, 1s
                    }
                }
            }
            if ($lastError !== null) {
                $modules->update('olts', $id, ['status' => 'offline']);
                $lineas[] = ((string) ($olt['name'] ?? 'OLT')) . ': error (' . $lastError . ')';
            } else {
                $lineas[] = (string) $summary;
            }
        }
        return 'Sincronización OLT (SNMP) -> ' . implode(' | ', $lineas);
    }

    private static function syncSimpleQueues(Modules $modules): string
    {
        $routers = $modules->list('routers', []);
        if ($routers === []) {
            return 'No hay routers MikroTik registrados.';
        }

        $lineas = [];
        foreach ($routers as $router) {
            $name = (string) ($router['name'] ?? 'router');
            if (trim((string) ($router['ip_address'] ?? '')) === '') {
                $lineas[] = "{$name}: sin IP de gestión";
                continue;
            }
            try {
                $driver = new MikrotikTrafficDriver(Mikrotik::driver($router));
                $queues = $driver->listSimpleQueues();
                $count = count($queues);
                $modules->update('routers', (int) $router['id'], ['active_simplequeues' => $count, 'status' => 'Conectado']);
                $lineas[] = "{$name}: {$count} Simple Queues";
            } catch (\Throwable $e) {
                $modules->update('routers', (int) $router['id'], ['status' => 'Desconectado']);
                $lineas[] = "{$name}: error (" . $e->getMessage() . ')';
            }
        }

        return 'Sincronización Simple Queues -> ' . implode(' | ', $lineas);
    }

    private static function syncPcq(Modules $modules): string
    {
        $routers = $modules->list('routers', []);
        if ($routers === []) {
            return 'No hay routers MikroTik registrados.';
        }

        $lineas = [];
        foreach ($routers as $router) {
            $name = (string) ($router['name'] ?? 'router');
            if (trim((string) ($router['ip_address'] ?? '')) === '') {
                $lineas[] = "{$name}: sin IP de gestión";
                continue;
            }
            try {
                $driver = new MikrotikTrafficDriver(Mikrotik::driver($router));
                $pcqProfiles = $driver->listPcqProfiles();
                $count = count($pcqProfiles);
                $modules->update('routers', (int) $router['id'], ['active_pcq' => $count, 'status' => 'Conectado']);
                $lineas[] = "{$name}: {$count} perfiles PCQ";
            } catch (\Throwable $e) {
                $modules->update('routers', (int) $router['id'], ['status' => 'Desconectado']);
                $lineas[] = "{$name}: error (" . $e->getMessage() . ')';
            }
        }

        return 'Sincronización PCQ -> ' . implode(' | ', $lineas);
    }

    private static function syncFreeRadius(Modules $modules): string
    {
        try {
            $driver = FreeRadiusProvider::make();
            $health = $driver->testConnection();
            if (!$health['ok']) {
                return 'FreeRADIUS: ' . $health['message'];
            }

            $activeSessions = $driver->getActiveSessions();
            $count = count($activeSessions);

            // Obtener estadísticas globales
            $stats = $driver->getGlobalStats();

            $totalUsers = $stats['total_users'] ?? 'N/A';
            $totalTraffic = $stats['total_traffic_gb'] ?? 'N/A';
            return "FreeRADIUS: {$count} sesiones activas. Usuarios: {$totalUsers}. Tráfico: {$totalTraffic} GB.";
        } catch (\Throwable $e) {
            return 'FreeRADIUS: error (' . $e->getMessage() . ')';
        }
    }

    private static function syncOltOnus(Modules $modules): string
    {
        $olts = $modules->list('olts', []);
        if ($olts === []) {
            return 'No hay OLTs registrados.';
        }

        $lineas = [];
        foreach ($olts as $olt) {
            $id = (int) ($olt['id'] ?? 0);
            if ($id <= 0) continue;

            $creds = Olt::creds($olt);
            $result = Olt::syncOnus($creds, $modules, $id);
            $lineas[] = $result;
        }

        return 'Sincronización ONUs OLT -> ' . implode(' | ', $lineas);
    }
}
