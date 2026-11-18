<?php
declare(strict_types=1);

namespace App\Drivers\SmartOLT;

use App\Drivers\Contracts\OLTDriverInterface;
use App\Core\Config;
use RuntimeException;

/**
 * Provider/Factoría para instanciar el driver SmartOLT
 * Lee configuración desde config/config.php o variables de entorno
 */
final class SmartOLT_Provider
{
    public static function make(): OLTDriverInterface
    {
        $config = [
            'base_url'   => Config::get('smartolt.base_url', $_ENV['SMARTOLT_BASE_URL'] ?? 'https://api.smartolt.com'),
            'api_key'    => Config::get('smartolt.api_key', $_ENV['SMARTOLT_API_KEY'] ?? ''),
            'api_secret' => Config::get('smartolt.api_secret', $_ENV['SMARTOLT_API_SECRET'] ?? ''),
            'timeout'    => (int) Config::get('smartolt.timeout', $_ENV['SMARTOLT_TIMEOUT'] ?? 10),
        ];

        if ($config['api_key'] === '' || $config['api_secret'] === '') {
            throw new RuntimeException(
                'SmartOLT no configurado. Defina SMARTOLT_API_KEY y SMARTOLT_API_SECRET en .env o config/config.php'
            );
        }

        return new SmartOLT_Driver($config);
    }

    /**
     * Crea driver para una OLT específica (si SmartOLT maneja múltiples)
     */
    public static function makeForOlt(string $oltId): OLTDriverInterface
    {
        // SmartOLT API es global, el $oltId se usa en los métodos
        return self::make();
    }
}