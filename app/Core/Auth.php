<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Autenticación por sesión sobre la tabla `users` (roles/RBAC en BD).
 */
final class Auth
{
    public static function start(): void
    {
        if (session_status() === PHP_SESSION_ACTIVE) {
            return;
        }
        $name = (string) Config::get('security.session_name', 'netcore_isp_session');
        session_name($name);
        session_start();
    }

    public static function attempt(string $email, string $password): bool
    {
        $pdo  = Database::getConnection();
        $stmt = $pdo->prepare('SELECT * FROM users WHERE email = ? AND status = "active" LIMIT 1');
        $stmt->execute([$email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, (string) $user['password_hash'])) {
            return false;
        }

        $_SESSION['user'] = [
            'id'      => (int) $user['id'],
            'isp_id'  => (int) $user['isp_id'],
            'name'    => (string) $user['name'],
            'email'   => (string) $user['email'],
            'role_id' => (int) $user['role_id'],
        ];

        // Garantiza un token CSRF para esta sesión (lo usan el panel y la API).
        if (empty($_SESSION['csrf_token'])) {
            $_SESSION['csrf_token'] = bin2hex(random_bytes(32));
        }

        $pdo->prepare('UPDATE users SET last_login_at = NOW(), last_login_ip = ? WHERE id = ?')
            ->execute([$_SERVER['REMOTE_ADDR'] ?? null, (int) $user['id']]);

        return true;
    }

    public static function check(): bool
    {
        return isset($_SESSION['user']);
    }

    public static function user(): ?array
    {
        return $_SESSION['user'] ?? null;
    }

    public static function userName(): string
    {
        return (string) ($_SESSION['user']['name'] ?? 'system');
    }

    public static function ispId(): int
    {
        return (int) ($_SESSION['user']['isp_id'] ?? 1);
    }

    public static function logout(): void
    {
        $_SESSION = [];
        if (session_status() === PHP_SESSION_ACTIVE) {
            session_destroy();
        }
    }
}
