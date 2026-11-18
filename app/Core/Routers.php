<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Utilidades para construir credenciales RouterOS a partir del registro de un
 * router (mismo criterio que server.modules.ts).
 */
final class Routers
{
    public static function creds(array $router): array
    {
        $port = (int) ($router['api_port'] ?? 8728);
        if ($port <= 0) {
            $port = 8728;
        }
        $tls = $port === 8729
            || ($router['use_tls'] ?? null) === true
            || in_array(($router['use_tls'] ?? null), ['Sí', 'Si', '1'], true);

        return [
            'host'     => trim((string) ($router['ip_address'] ?? '')),
            'port'     => $port,
            'user'     => trim((string) ($router['username'] ?? 'admin')),
            'password' => (string) ($router['password'] ?? ''),
            'tls'      => $tls,
            'timeout'  => 8,
        ];
    }
}
