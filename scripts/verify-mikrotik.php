<?php
declare(strict_types=1);

/**
 * Prueba del cliente RouterOS en PHP contra el mock local.
 * Requiere que scripts/mock-routeros-server.ts esté escuchando en 127.0.0.1:18728.
 *
 * Uso: php scripts/verify-mikrotik.php
 */

require __DIR__ . '/../app/Support/bootstrap.php';

use App\Core\Mikrotik;

$creds = ['host' => '127.0.0.1', 'port' => 18728, 'user' => 'admin', 'password' => 'secret'];
$results = [];

$assert = static function (string $label, bool $cond, string $extra = '') use (&$results): void {
    $results[] = ($cond ? 'PASS' : 'FAIL') . "  {$label}" . ($extra !== '' ? " :: {$extra}" : '');
};

$test = Mikrotik::test($creds);
$assert('test ok', $test['ok'] === true, $test['message']);
$assert('identity', ($test['identity'] ?? null) === 'MockRouterOS', (string) ($test['identity'] ?? ''));
$assert('version', ($test['version'] ?? null) === '7.15.1');
$assert('board', ($test['board'] ?? null) === 'RB750Gr3');

$ppp = Mikrotik::runTool($creds, 'ppp-active', 'mock');
$assert('runTool ppp-active 3 filas', $ppp['rows'] === 3, 'rows=' . $ppp['rows']);

$identity = Mikrotik::runTool($creds, 'identity', 'mock');
$assert('runTool identity', str_contains($identity['text'], 'MockRouterOS'));

$trapOk = false;
try {
    Mikrotik::runTool($creds, 'address-list', 'mock');
} catch (Throwable $e) {
    $trapOk = str_contains($e->getMessage(), 'no such command');
}
$assert('!trap propagado', $trapOk);

$set = Mikrotik::setPppoeEnabled($creds, 'cliente_101', false);
$assert('setPppoeEnabled ok', $set['ok'] === true, $set['message']);

$bad = Mikrotik::test(['host' => '127.0.0.1', 'port' => 1, 'user' => 'admin', 'password' => 'x', 'timeout' => 1]);
$assert('fallo de conexión reportado', $bad['ok'] === false, $bad['message']);

echo implode("\n", $results) . "\n";
$failed = array_filter($results, static fn ($r) => str_starts_with($r, 'FAIL'));
echo "\n" . (count($results) - count($failed)) . '/' . count($results) . " pruebas OK\n";
exit($failed === [] ? 0 : 1);
