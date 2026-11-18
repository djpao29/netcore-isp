<?php
declare(strict_types=1);

use App\Core\Auth;
use App\Core\Config;

Auth::start();
$authenticated = Auth::check();
$csrf  = csrf_token();
$appName = (string) Config::get('app.name', 'NetCore ISP');
$base  = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '')), '/');
?>
<!DOCTYPE html>
<html lang="es" data-bs-theme="light">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="csrf-token" content="<?= htmlspecialchars($csrf, ENT_QUOTES, 'UTF-8') ?>">
    <base href="<?= htmlspecialchars($base . '/', ENT_QUOTES, 'UTF-8') ?>">
    <title><?= htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') ?> — Panel WISP/FTTH</title>
    <script>
      (function () {
        try {
          var t = localStorage.getItem('netcore.theme') || 'light';
          document.documentElement.setAttribute('data-theme', t);
          document.documentElement.setAttribute('data-bs-theme', t);
        } catch (e) {}
      })();
    </script>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/css/bootstrap.min.css" rel="stylesheet">
    <link href="assets/app.css" rel="stylesheet">
</head>
<body>
<?php if (!$authenticated): ?>
    <div class="login-wrap">
        <div class="card login-card shadow-lg">
            <div class="card-body p-4">
                <h1 class="h4 mb-1"><?= htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') ?></h1>
                <p class="text-secondary small mb-4">Sistema integral de gestión WISP &amp; FTTH</p>
                <div id="loginError" class="alert alert-danger py-2 small d-none"></div>
                <form id="loginForm">
                    <div class="mb-3">
                        <label class="form-label small">Correo electrónico</label>
                        <input type="email" name="email" class="form-control" required autocomplete="username">
                    </div>
                    <div class="mb-3">
                        <label class="form-label small">Contraseña</label>
                        <input type="password" name="password" class="form-control" required autocomplete="current-password">
                    </div>
                    <button type="submit" class="btn btn-primary w-100">Ingresar</button>
                </form>
            </div>
        </div>
    </div>
<?php else: ?>
    <div class="app-shell">
        <aside class="app-sidebar">
            <div class="sidebar-brand">
                <span class="brand-dot"></span>
                <span class="fw-semibold"><?= htmlspecialchars($appName, ENT_QUOTES, 'UTF-8') ?></span>
            </div>
            <nav id="navGroups" class="nav-groups"></nav>
            <button id="logoutBtn" class="btn btn-sm btn-outline-secondary w-100 mt-3">Cerrar sesión</button>
        </aside>
        <main class="app-main">
            <div class="app-topbar">
                <div id="breadcrumb" class="text-secondary small">Panel</div>
                <div class="text-secondary small" id="userInfo"></div>
            </div>
            <div id="toast" class="app-toast d-none"></div>
            <div id="content" class="app-content">
                <div class="text-secondary">Cargando panel…</div>
            </div>
        </main>
    </div>
<?php endif; ?>
<button type="button" id="themeToggle" class="theme-toggle" title="Cambiar tema claro/oscuro" aria-label="Cambiar tema claro/oscuro" style="position:fixed;bottom:20px;right:20px;z-index:9999;">
  <span id="themeIcon">🌙</span>
</button>
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.3/dist/js/bootstrap.bundle.min.js"></script>
<script src="assets/app.js"></script>
</body>
</html>
