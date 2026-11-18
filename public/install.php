<?php
declare(strict_types=1);

/**
 * NetCore ISP — Asistente de instalación (XAMPP / cPanel)
 *
 * Crea la base de datos, ejecuta las migraciones, da de alta la empresa y el
 * usuario administrador, y genera config/config.php.
 *
 * PASO FINAL OBLIGATORIO: elimina este archivo (public/install.php) al terminar.
 */

require __DIR__ . '/../app/Support/bootstrap.php';

$configFile = BASE_PATH . '/config/config.php';
$alreadyInstalled = is_file($configFile);
$force = isset($_GET['force']) && $_GET['force'] === '1';

$errors = [];
$done = false;
$panelUrl = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/') . '/index.php';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $in = static fn (string $k, string $d = ''): string => trim((string) ($_POST[$k] ?? $d));

    $dbHost = $in('db_host', '127.0.0.1');
    $dbPort = (int) ($_POST['db_port'] ?? 3306) ?: 3306;
    $dbName = $in('db_name', 'netcore_isp');
    $dbUser = $in('db_user', 'root');
    $dbPass = (string) ($_POST['db_pass'] ?? '');

    $company   = $in('company_name', 'Mi ISP');
    $domain    = $in('domain', 'localhost');
    $currency  = $in('currency', 'USD');
    $currencySymbol = $in('currency_symbol', '$');
    $timezone  = $in('timezone', 'America/Santo_Domingo');

    $adminName  = $in('admin_name', 'Administrador');
    $adminEmail = $in('admin_email');
    $adminPass  = (string) ($_POST['admin_pass'] ?? '');

    if ($alreadyInstalled && !$force) {
        $errors[] = 'Ya existe config/config.php. Para reinstalar, vuelve a abrir este instalador con ?force=1.';
    }
    if (!preg_match('/^[A-Za-z0-9_]+$/', $dbName)) {
        $errors[] = 'El nombre de la base de datos solo puede contener letras, números y guion bajo.';
    }
    if (!filter_var($adminEmail, FILTER_VALIDATE_EMAIL)) {
        $errors[] = 'Ingresa un correo válido para el administrador.';
    }
    if (strlen($adminPass) < 8) {
        $errors[] = 'La contraseña del administrador debe tener al menos 8 caracteres.';
    }

    if ($errors === []) {
        try {
            // 1) Crear la base de datos si no existe.
            $serverDsn = "mysql:host={$dbHost};port={$dbPort};charset=utf8mb4";
            $server = new PDO($serverDsn, $dbUser, $dbPass, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
            $server->exec("CREATE DATABASE IF NOT EXISTS `{$dbName}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci");

            // 2) Conectar a la base y ejecutar migraciones.
            $pdo = new PDO(
                "mysql:host={$dbHost};port={$dbPort};dbname={$dbName};charset=utf8mb4",
                $dbUser,
                $dbPass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION, PDO::ATTR_EMULATE_PREPARES => false]
            );

            $migrations = glob(BASE_PATH . '/database/migrations/*.sql') ?: [];
            sort($migrations);
            foreach ($migrations as $file) {
                $sql = (string) file_get_contents($file);
                if (trim($sql) === '') {
                    continue;
                }
                $pdo->exec($sql);
            }

            // 3) Empresa (ISP) y moneda.
            $existing = $pdo->query('SELECT COUNT(*) FROM isps')->fetchColumn();
            if ((int) $existing === 0) {
                $stmt = $pdo->prepare(
                    'INSERT INTO isps (code, name, domain, portal_domain, currency, currency_symbol, timezone, status)
                     VALUES (?, ?, ?, ?, ?, ?, ?, "active")'
                );
                $stmt->execute([
                    'ISP-001',
                    $company,
                    $domain,
                    'clientes.' . $domain,
                    $currency,
                    $currencySymbol,
                    $timezone,
                ]);
            }

            // 4) Rol administrador (catálogo global) y usuario.
            $pdo->exec(
                'INSERT IGNORE INTO roles (code, name, description)
                 VALUES ("SUPERADMIN", "Superadministrador", "Acceso total al sistema")'
            );
            $roleId = (int) $pdo->query('SELECT id FROM roles WHERE code = "SUPERADMIN" LIMIT 1')->fetchColumn();
            $ispId  = (int) $pdo->query('SELECT id FROM isps ORDER BY id ASC LIMIT 1')->fetchColumn();

            $hash = password_hash($adminPass, PASSWORD_DEFAULT);
            $stmt = $pdo->prepare(
                'INSERT INTO users (isp_id, role_id, name, email, password_hash, status)
                 VALUES (?, ?, ?, ?, ?, "active")
                 ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), name = VALUES(name)'
            );
            $stmt->execute([$ispId, $roleId, $adminName, $adminEmail, $hash]);

            // 5) Escribir config/config.php.
            $appKey  = bin2hex(random_bytes(24));
            $debug   = 'false';
            $config  = "<?php\ndeclare(strict_types=1);\n\n"
                . "// Generado por el instalador. No lo subas a repositorios públicos.\n"
                . "return [\n"
                . "    'app' => [\n"
                . "        'name'     => " . var_export($company . ' — NetCore ISP', true) . ",\n"
                . "        'url'      => '',\n"
                . "        'timezone' => " . var_export($timezone, true) . ",\n"
                . "        'debug'    => {$debug},\n"
                . "    ],\n"
                . "    'database' => [\n"
                . "        'host'     => " . var_export($dbHost, true) . ",\n"
                . "        'port'     => {$dbPort},\n"
                . "        'database' => " . var_export($dbName, true) . ",\n"
                . "        'username' => " . var_export($dbUser, true) . ",\n"
                . "        'password' => " . var_export($dbPass, true) . ",\n"
                . "        'charset'  => 'utf8mb4',\n"
                . "    ],\n"
                . "    'security' => [\n"
                . "        'session_name' => 'netcore_isp_session',\n"
                . "        'app_key'      => " . var_export($appKey, true) . ",\n"
                . "    ],\n"
                . "];\n";

            if (@file_put_contents($configFile, $config) === false) {
                $errors[] = 'No se pudo escribir config/config.php. Revisa los permisos de la carpeta config/.';
            } else {
                $done = true;
            }
        } catch (PDOException $e) {
            $errors[] = 'Error de base de datos: ' . $e->getMessage();
        } catch (Throwable $e) {
            $errors[] = 'Error: ' . $e->getMessage();
        }
    }
}
?>
<!DOCTYPE html>
<html lang="es" data-bs-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Instalador — NetCore ISP</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
</head>
<body class="bg-dark text-light">
<div class="container py-5" style="max-width: 760px;">
    <h1 class="h3 mb-1">Instalador de NetCore ISP</h1>
    <p class="text-secondary">Configura la base de datos MySQL y crea tu cuenta de administrador. Compatible con XAMPP y cPanel.</p>

    <?php if ($done): ?>
        <div class="alert alert-success">
            <h2 class="h5">¡Instalación completada!</h2>
            <p class="mb-2">La base de datos se creó, las migraciones se ejecutaron y tu usuario administrador quedó registrado.</p>
            <p class="mb-0"><strong>Paso obligatorio de seguridad:</strong> elimina el archivo <code>public/install.php</code>.</p>
        </div>
        <a class="btn btn-primary" href="<?= htmlspecialchars($panelUrl, ENT_QUOTES, 'UTF-8') ?>">Ir al panel</a>
    <?php else: ?>
        <?php if ($errors): ?>
            <div class="alert alert-danger">
                <ul class="mb-0">
                    <?php foreach ($errors as $error): ?>
                        <li><?= htmlspecialchars($error, ENT_QUOTES, 'UTF-8') ?></li>
                    <?php endforeach; ?>
                </ul>
            </div>
        <?php endif; ?>
        <?php if ($alreadyInstalled && !$force): ?>
            <div class="alert alert-warning">Ya existe una instalación. <a href="?force=1" class="alert-link">Forzar reinstalación</a>.</div>
        <?php endif; ?>

        <form method="post" class="card bg-body-tertiary border-secondary">
            <div class="card-body">
                <h2 class="h6 text-info">1. Base de datos MySQL</h2>
                <div class="row g-3 mb-4">
                    <div class="col-md-6"><label class="form-label small">Host</label>
                        <input name="db_host" class="form-control" value="<?= htmlspecialchars($_POST['db_host'] ?? '127.0.0.1', ENT_QUOTES) ?>"></div>
                    <div class="col-md-6"><label class="form-label small">Puerto</label>
                        <input name="db_port" class="form-control" value="<?= htmlspecialchars((string) ($_POST['db_port'] ?? '3306'), ENT_QUOTES) ?>"></div>
                    <div class="col-md-6"><label class="form-label small">Nombre de la base</label>
                        <input name="db_name" class="form-control" value="<?= htmlspecialchars($_POST['db_name'] ?? 'netcore_isp', ENT_QUOTES) ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Usuario</label>
                        <input name="db_user" class="form-control" value="<?= htmlspecialchars($_POST['db_user'] ?? 'root', ENT_QUOTES) ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Contraseña</label>
                        <input name="db_pass" type="password" class="form-control" value="<?= htmlspecialchars((string) ($_POST['db_pass'] ?? ''), ENT_QUOTES) ?>"></div>
                </div>

                <h2 class="h6 text-info">2. Datos de la empresa</h2>
                <div class="row g-3 mb-4">
                    <div class="col-md-6"><label class="form-label small">Nombre de la empresa</label>
                        <input name="company_name" class="form-control" value="<?= htmlspecialchars($_POST['company_name'] ?? 'Mi ISP', ENT_QUOTES) ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Dominio</label>
                        <input name="domain" class="form-control" value="<?= htmlspecialchars($_POST['domain'] ?? 'localhost', ENT_QUOTES) ?>"></div>
                    <div class="col-md-4"><label class="form-label small">Moneda (ISO)</label>
                        <input name="currency" class="form-control" value="<?= htmlspecialchars($_POST['currency'] ?? 'USD', ENT_QUOTES) ?>"></div>
                    <div class="col-md-4"><label class="form-label small">Símbolo</label>
                        <input name="currency_symbol" class="form-control" value="<?= htmlspecialchars($_POST['currency_symbol'] ?? '$', ENT_QUOTES) ?>"></div>
                    <div class="col-md-4"><label class="form-label small">Zona horaria</label>
                        <input name="timezone" class="form-control" value="<?= htmlspecialchars($_POST['timezone'] ?? 'America/Santo_Domingo', ENT_QUOTES) ?>"></div>
                </div>

                <h2 class="h6 text-info">3. Administrador</h2>
                <div class="row g-3">
                    <div class="col-md-6"><label class="form-label small">Nombre</label>
                        <input name="admin_name" class="form-control" value="<?= htmlspecialchars($_POST['admin_name'] ?? 'Administrador', ENT_QUOTES) ?>"></div>
                    <div class="col-md-6"><label class="form-label small">Correo</label>
                        <input name="admin_email" type="email" class="form-control" value="<?= htmlspecialchars((string) ($_POST['admin_email'] ?? ''), ENT_QUOTES) ?>" required></div>
                    <div class="col-md-6"><label class="form-label small">Contraseña (mín. 8)</label>
                        <input name="admin_pass" type="password" class="form-control" required></div>
                </div>

                <button type="submit" class="btn btn-primary mt-4">Instalar</button>
            </div>
        </form>
    <?php endif; ?>
</div>
</body>
</html>
