<?php
declare(strict_types=1);

/**
 * Arranque del backend PHP: autoload PSR-4 sencillo (App\ -> app/) y helpers.
 * Se incluye desde public/index.php, public/install.php y cron.php.
 */

if (!defined('BASE_PATH')) {
    define('BASE_PATH', dirname(__DIR__, 2));
}

spl_autoload_register(static function (string $class): void {
    $prefix = 'App\\';
    if (!str_starts_with($class, $prefix)) {
        return;
    }
    $relative = substr($class, strlen($prefix));
    $file     = BASE_PATH . '/app/' . str_replace('\\', '/', $relative) . '.php';
    if (is_file($file)) {
        require $file;
    }
});

/** Devuelve una respuesta JSON y termina. */
function json_response(array $payload, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Lee el cuerpo JSON de la petición y lo devuelve como arreglo. */
function json_input(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : [];
}

/** Aplica la zona horaria y el modo de errores según la configuración. */
function apply_app_config(): void
{
    if (!\App\Core\Config::isInstalled()) {
        return;
    }
    date_default_timezone_set((string) \App\Core\Config::get('app.timezone', 'UTC'));
    $debug = (bool) \App\Core\Config::get('app.debug', false);
    ini_set('display_errors', $debug ? '1' : '0');
    error_reporting($debug ? E_ALL : E_ALL & ~E_DEPRECATED & ~E_NOTICE);
}

/** Token CSRF de la sesión (lo crea si no existe). */
function csrf_token(): string
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        \App\Core\Auth::start();
    }
    if (empty($_SESSION['csrf_token'])) {
        $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
    }
    return (string) $_SESSION['csrf_token'];
}

/** Valida el token CSRF enviado por el cliente. */
function csrf_check(): bool
{
    if (session_status() !== PHP_SESSION_ACTIVE) {
        \App\Core\Auth::start();
    }
    $token = (string) ($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ($_POST['_csrf'] ?? ''));
    $known = (string) ($_SESSION['csrf_token'] ?? '');
    return $token !== '' && $known !== '' && hash_equals($known, $token);
}
