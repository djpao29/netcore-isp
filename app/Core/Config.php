<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Carga y expone config/config.php con acceso por notación de puntos.
 */
final class Config
{
    private static ?array $data = null;

    private static function configFile(): string
    {
        $base = defined('BASE_PATH') ? BASE_PATH : dirname(__DIR__, 2);
        return $base . '/config/config.php';
    }

    public static function isInstalled(): bool
    {
        return is_file(self::configFile());
    }

    public static function load(): array
    {
        if (self::$data !== null) {
            return self::$data;
        }

        $file = self::configFile();
        if (!is_file($file)) {
            throw new RuntimeException('No existe config/config.php. Ejecuta el instalador en /public/install.php.');
        }

        $data = require $file;
        if (!is_array($data)) {
            throw new RuntimeException('config/config.php debe devolver un arreglo de configuración.');
        }

        self::$data = $data;
        return $data;
    }

    public static function get(string $key, mixed $default = null): mixed
    {
        $value = self::load();
        foreach (explode('.', $key) as $part) {
            if (!is_array($value) || !array_key_exists($part, $value)) {
                return $default;
            }
            $value = $value[$part];
        }
        return $value;
    }
}
