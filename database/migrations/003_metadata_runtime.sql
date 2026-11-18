-- ============================================================================
--  MIGRACIÓN 003: RUNTIME METADATA-DRIVEN (PHP 8.2 + MySQL 5.7/8)
--  Almacena los registros de todos los módulos del panel en una tabla
--  genérica con la carga útil en JSON. Esto permite que el backend PHP
--  reproduzca exactamente el CRUD genérico del panel (misma fuente de
--  verdad: app/Generated/modules.json).
--  Compatible con MySQL 5.7+ y MariaDB 10.2+ (XAMPP / cPanel).
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `module_records` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `isp_id` INT UNSIGNED NOT NULL DEFAULT 1,
    `module_key` VARCHAR(64) NOT NULL COMMENT 'Clave del módulo (zones, customers, invoices...)',
    `code` VARCHAR(64) NULL COMMENT 'Código visible del registro (Código, RB-0001...)',
    `data` JSON NOT NULL COMMENT 'Carga útil del registro con los campos del módulo',
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_modrec_module` (`module_key`, `isp_id`),
    INDEX `idx_modrec_code` (`module_key`, `code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Registro de auditoría de acciones del panel y CLI/CRON.
CREATE TABLE IF NOT EXISTS `audit_events` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `isp_id` INT UNSIGNED NOT NULL DEFAULT 1,
    `user_name` VARCHAR(120) NOT NULL DEFAULT 'system',
    `action` VARCHAR(40) NOT NULL,
    `module_name` VARCHAR(80) NOT NULL,
    `record_id` VARCHAR(80) NULL,
    `details` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_audit_created` (`created_at`),
    INDEX `idx_audit_module` (`module_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
