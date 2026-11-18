<?php
declare(strict_types=1);

namespace App\Drivers\FreeRADIUS;

use App\Core\Config;
use RuntimeException;

/**
 * Provider/Factoría para instanciar el driver FreeRADIUS
 * Lee configuración desde config/config.php o variables de entorno
 */
final class FreeRadiusProvider
{
    public static function make(): FreeRadiusDriver
    {
        $config = [
            'base_url'  => Config::get('freeradius.base_url', $_ENV['FREERADIUS_BASE_URL'] ?? 'http://localhost:3000'),
            'username'  => Config::get('freeradius.username', $_ENV['FREERADIUS_USERNAME'] ?? 'admin'),
            'password'  => Config::get('freeradius.password', $_ENV['FREERADIUS_PASSWORD'] ?? ''),
            'database'  => Config::get('freeradius.database', $_ENV['FREERADIUS_DATABASE'] ?? 'radius'),
            'timeout'   => (int) Config::get('freeradius.timeout', $_ENV['FREERADIUS_TIMEOUT'] ?? 10),
        ];

        if ($config['username'] === '' || $config['password'] === '') {
            throw new RuntimeException(
                'FreeRADIUS no configurado. Defina FREERADIUS_USERNAME y FREERADIUS_PASSWORD en .env o config/config.php'
            );
        }

        return new FreeRadiusDriver($config);
    }
}