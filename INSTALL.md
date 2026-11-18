# Instalación en XAMPP y cPanel

NetCore ISP es **PHP 8.0+ + MySQL 5.7/8+** (funciona en XAMPP/MariaDB y en hosting compartido con cPanel). El panel React que
acompaña al repositorio (`npm run dev`) es una **demo/vista previa**; el sistema instalable es el de esta guía (`public/`).

---

## Requisitos

| Componente | Versión |
|------------|---------|
| PHP        | 8.0 o superior (probado en 8.0.30 y 8.2.35) |
| Extensiones| `pdo_mysql`, `mbstring`, `json`, `openssl` (para RouterOS TLS) |
| MySQL      | 5.7+ / MariaDB 10.2+ (XAMPP o cPanel) |
| Apache     | con `mod_rewrite` habilitado |

---

## 1. Instalación en XAMPP (Windows / macOS / Linux)

1. Copia el proyecto dentro de `htdocs`:
   - Windows: `C:\xampp\htdocs\netcore-isp`
   - macOS/Linux: `/Applications/XAMPP/htdocs/netcore-isp` o `/opt/lampp/htdocs/netcore-isp`
2. Inicia **Apache** y **MySQL** desde el panel de XAMPP.
3. Abre en el navegador:

   ```
   http://localhost/netcore-isp/public/install.php
   ```

4. Completa el asistente:
   - **Base de datos**: host `127.0.0.1`, puerto `3306`, usuario `root`, contraseña vacía (por defecto en XAMPP).
     El nombre de la base se crea automáticamente.
   - **Empresa**: nombre, dominio, moneda y zona horaria.
   - **Administrador**: nombre, correo y contraseña (mínimo 8 caracteres).
5. Al finalizar, **elimina `public/install.php`** (paso de seguridad obligatorio).
6. Entra al panel: `http://localhost/netcore-isp/public/`

> Si prefieres una URL sin `/public`, activa `mod_rewrite` y usa la raíz
> `http://localhost/netcore-isp/` (el `.htaccess` raíz redirige a `public/`).

---

## 2. Instalación en cPanel (hosting compartido)

### Opción A — Dominio apuntando a `public/` (recomendada)

1. Sube el proyecto (FTP o **File Manager**), por ejemplo a `/home/USUARIO/netcore-isp`.
2. En cPanel → **Domains**, asigna el dominio (o subdominio `panel.midominio.com`) y fija su
   **Document Root** a `/home/USUARIO/netcore-isp/public`.
3. En cPanel → **MySQL® Databases**:
   - Crea una base de datos (cPanel añade el prefijo, ej. `usuario_netcore`).
   - Crea un usuario y asígnalo a la base con **todos los privilegios**.
4. Abre `https://panel.midominio.com/install.php` y completa el asistente con los datos de la base
   creados en el paso 3 (host casi siempre `localhost`).
5. Elimina `public/install.php`.
6. Selecciona la versión de PHP 8.0+ en cPanel → **MultiPHP Manager**.

### Opción B — Dominio en la raíz del proyecto

Si no puedes cambiar el Document Root, deja el dominio apuntando a `/home/USUARIO/netcore-isp`.
El `.htaccess` raíz reescribe internamente hacia `public/` (requiere `mod_rewrite`, activo por defecto en cPanel).

### Permisos

- `config/` debe ser escribible durante la instalación (para crear `config/config.php`). Después puedes dejarlo en `755`.
- El resto del proyecto en `644` (archivos) y `755` (carpetas).

---

## 3. Tareas programadas (cron)

### cPanel → Cron Jobs

Añade una tarea que llame al ejecutor CLI. Ajusta la ruta y el binario de PHP de tu hosting
(puedes ver la ruta en **MultiPHP Manager** o con `which php`):

```bash
# Facturación mensual: día 1 a las 02:00
0 2 1 * *  /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php invoices:generate

# Marcar vencidas: todos los días a las 03:00
0 3 * * *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php invoices:check-overdue

# Cortes de morosos (BD + RouterOS real): todos los días a las 04:00
0 4 * * *   /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php customers:suspend

# Leer sesiones PPPoE reales de cada router: cada 15 min
*/15 * * * * /usr/local/bin/php /home/USUARIO/netcore-isp/cron.php mikrotik:sync
```

### XAMPP / Windows (Programador de tareas)

```powershell
C:\xampp\php\php.exe C:\xampp\htdocs\netcore-isp\cron.php customers:suspend
```

---

## 4. Actualizar el árbol de módulos

El menú, tablas y formularios del panel PHP se generan desde `shared/modules.ts`
(fuente única de verdad compartida con el panel React). Tras editar los módulos, regenera:

```bash
npm install        # solo la primera vez
npm run generate:php
```

Esto reescribe `app/Generated/modules.json`. **No** hace falta tocar la base de datos: todos los
módulos comparten la tabla `module_records`.

---

## 5. Estructura relevante

```
public/                 → Document root recomendado
  index.php             → Front controller (API JSON + panel)
  install.php           → Asistente de instalación (ELIMINAR tras instalar)
  assets/app.js|app.css → Panel (CRUD metadata-driven)
  .htaccess             → Reescribe a index.php
app/Core/               → Config, Database (PDO), Modules (CRUD genérico),
                          Auth, Mikrotik (API RouterOS real), Routers, Cron
app/Generated/          → modules.json (generado desde shared/modules.ts)
app/Views/app.php       → Shell del panel
config/config.sample.php→ Plantilla de configuración
database/migrations/    → 001 (esquema), 002 (inventario de red), 003 (runtime)
cron.php                → Ejecutor CLI de tareas programadas
```

---

## 6. Notas de seguridad

- Elimina `public/install.php` después de instalar.
- Mantén `config/`, `app/` y `database/` sin acceso web directo (los `.htaccess` incluidos ya lo bloquean).
- El panel usa sesión + token **CSRF** en todas las operaciones que modifican datos.
- No hay datos de demostración: la instalación arranca con todo vacío y solo se llena con tus datos reales.
