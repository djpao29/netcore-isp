<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Lee el registro de módulos generado desde shared/modules.ts
 * (npm run generate:php) para que el backend PHP comparta la misma
 * definición de módulos, columnas, campos y valores por defecto.
 */
final class ModuleRegistry
{
    private static ?array $payload = null;

    public static function payload(): array
    {
        if (self::$payload !== null) {
            return self::$payload;
        }

        $base = defined('BASE_PATH') ? BASE_PATH : dirname(__DIR__, 2);
        $file = $base . '/app/Generated/modules.json';
        if (!is_file($file)) {
            throw new RuntimeException('Falta app/Generated/modules.json. Ejecuta "npm run generate:php".');
        }

        $decoded = json_decode((string) file_get_contents($file), true);
        if (!is_array($decoded)) {
            throw new RuntimeException('app/Generated/modules.json no es un JSON válido.');
        }

        self::$payload = $decoded;
        return self::$payload;
    }

    /** @return array<int, array<string, mixed>> */
    public static function modules(): array
    {
        return self::payload()['modules'] ?? [];
    }

    /** @return array<int, string> */
    public static function groups(): array
    {
        return self::payload()['groups'] ?? [];
    }

    /** @return array<string, array<string, mixed>> */
    public static function map(): array
    {
        $map = [];
        foreach (self::modules() as $module) {
            $map[(string) ($module['key'] ?? '')] = $module;
        }
        return $map;
    }

    public static function find(string $key): ?array
    {
        return self::map()[$key] ?? null;
    }
}
