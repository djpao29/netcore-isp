#!/usr/bin/env php
<?php
declare(strict_types=1);

/**
 * NetCore ISP — Ejecutor CLI de tareas programadas (cPanel / cron).
 *
 * Ejemplos de cron en cPanel (cada hora o diario):
 *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php invoices:generate
 *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php invoices:check-overdue
 *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php customers:suspend
 *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php mikrotik:sync
 */

require __DIR__ . '/app/Support/bootstrap.php';

use App\Core\Config;
use App\Core\Cron;
use App\Core\Database;
use App\Core\Modules;

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit("Este script solo puede ejecutarse por línea de comandos.\n");
}

$commands = [
    'invoices:generate'      => 'Genera facturación mensual para clientes activos.',
    'invoices:check-overdue' => 'Marca como Vencidas las facturas con fecha de vencimiento pasada.',
    'customers:suspend'      => 'Suspende morosos (BD) y aplica el corte PPPoE real en RouterOS.',
    'mikrotik:sync'          => 'Lee por API RouterOS las sesiones PPPoE activas de cada router.',
    'olt:sync'               => 'Consulta OLTs por SNMP/Telnet (pendiente de integración).',
    'simplequeue:sync'       => 'Sincroniza Simple Queues desde routers MikroTik.',
    'pcq:sync'               => 'Sincroniza perfiles PCQ desde routers MikroTik.',
    'freeradius:sync'        => 'Sincroniza sesiones activas desde FreeRADIUS.',
    'olt:onu:sync'           => 'Sincroniza ONUs desde SmartOLT.',
];

$command = $argv[1] ?? 'help';

if ($command === 'help' || !isset($commands[$command])) {
    echo "NetCore ISP — Tareas programadas (PHP " . PHP_VERSION . ")\n";
    echo "Uso: php cron.php <comando>\n\nComandos disponibles:\n";
    foreach ($commands as $cmd => $desc) {
        printf("  %-26s %s\n", $cmd, $desc);
    }
    exit(0);
}

if (!Config::isInstalled()) {
    fwrite(STDERR, "La aplicación no está instalada (falta config/config.php).\n");
    exit(1);
}

apply_app_config();

try {
    $pdo     = Database::getConnection();
    $modules = new Modules($pdo, 1);
    $summary = Cron::run($command, $modules);
    $modules->appendAudit('CRON_EXEC', 'System/CLI', $command, $summary);
    echo '[' . date('Y-m-d H:i:s') . "] php cron.php {$command} -> {$summary}\n";
    exit(0);
} catch (Throwable $e) {
    fwrite(STDERR, '[' . date('Y-m-d H:i:s') . "] ERROR {$command}: " . $e->getMessage() . "\n");
    exit(1);
}
