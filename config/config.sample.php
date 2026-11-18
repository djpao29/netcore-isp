<?php
declare(strict_types=1);

/**
 * NetCore ISP — Configuración de la aplicación (PHP 8.2 + MySQL)
 *
 * Copia este archivo a config/config.php y ajusta los valores.
 * El instalador (public/install.php) crea config/config.php automáticamente.
 *
 * En XAMPP por defecto: host 127.0.0.1, usuario root, sin contraseña.
 * En cPanel: usa el usuario/prefijo y la base de datos que creaste en MySQL.
 */

return [
    'app' => [
        'name'     => 'NetCore ISP',
        'url'      => '',                                  // Ej: https://panel.midominio.com
        'timezone' => 'America/Santo_Domingo',
        'debug'    => false,
    ],

    'database' => [
        'host'     => '127.0.0.1',
        'port'     => 3306,
        'database' => 'netcore_isp',
        'username' => 'root',
        'password' => '',
        'charset'  => 'utf8mb4',
    ],

    'security' => [
        'session_name'     => 'netcore_isp_session',
        // Cambia esta clave por una cadena aleatoria larga (32+ caracteres).
        'app_key'          => 'cambia-esta-clave-por-una-aleatoria-de-32-caracteres',
        // Token del colector on-prem (X-Collector-Token). Vacio = deshabilitado.
        'collector_token'  => '',
        // ISP/tenant al que se asocian los datos del colector (cuando no hay sesion).
        'collector_isp_id' => 1,
    ],
];
