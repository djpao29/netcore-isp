<?php
declare(strict_types=1);

// Generado por el instalador. No lo subas a repositorios públicos.
return [
    'app' => [
        'name'     => 'Mi ISP — NetCore ISP',
        'url'      => '',
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
        'session_name' => 'netcore_isp_session',
        'app_key'      => '06044275b057a39bda36d44db587c78b92e2d295ae055428',
    ],
    'smartolt' => [
        'base_url'   => 'https://api.smartolt.com',
        'api_key'    => '',
        'api_secret' => '',
        'timeout'    => 10,
    ],
    'freeradius' => [
        'base_url'  => 'http://localhost:3000',
        'username'  => 'admin',
        'password'  => '',
        'database'  => 'radius',
        'timeout'   => 10,
    ],
];
