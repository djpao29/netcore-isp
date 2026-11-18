<?php
declare(strict_types=1);

namespace App\Core;

use PDO;
use PDOException;
use RuntimeException;

/**
 * Conexión PDO Singleton con soporte Multi-Tenant, Prepared Statements estrictos
 * y protección contra inyección SQL. Lee la configuración desde Config.
 */
final class Database
{
    private static ?PDO $instance = null;

    private function __construct() {}

    public static function getConnection(): PDO
    {
        if (self::$instance === null) {
            $host    = (string) Config::get('database.host', '127.0.0.1');
            $port    = (int) Config::get('database.port', 3306);
            $db      = (string) Config::get('database.database', 'netcore_isp');
            $user    = (string) Config::get('database.username', 'root');
            $pass    = (string) Config::get('database.password', '');
            $charset = (string) Config::get('database.charset', 'utf8mb4');

            $dsn = "mysql:host={$host};port={$port};dbname={$db};charset={$charset}";

            $options = [
                PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES   => false,
                PDO::MYSQL_ATTR_INIT_COMMAND => "SET NAMES {$charset} COLLATE utf8mb4_unicode_ci",
            ];

            try {
                self::$instance = new PDO($dsn, $user, $pass, $options);
            } catch (PDOException $e) {
                error_log('[NetCore Database Error] ' . $e->getMessage());
                throw new RuntimeException('Error de conexión con la base de datos MySQL: ' . $e->getMessage());
            }
        }

        return self::$instance;
    }

    public static function reset(): void
    {
        self::$instance = null;
    }
}
