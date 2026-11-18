-- ============================================================================
-- MIGRACIÓN 002: MÓDULO DE INVENTARIO DE RED UNIFICADO (AP, CPE, OLT, ROUTER)
-- Motor: MySQL 8.0+ (InnoDB, utf8mb4_unicode_ci)
-- ============================================================================

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS `network_inventory` (
    `id` INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
    `isp_id` INT UNSIGNED NOT NULL DEFAULT 1,
    `device_code` VARCHAR(32) NOT NULL COMMENT 'Código interno: AP-001, CPE-104, OLT-01, RTR-01',
    `name` VARCHAR(120) NOT NULL COMMENT 'Nombre o Hostname del equipo',
    `device_type` ENUM('AP', 'CPE', 'OLT', 'Router', 'PTP', 'Switch') NOT NULL,
    `brand` VARCHAR(80) NOT NULL COMMENT 'Ubiquiti, MikroTik, Cambium, Mimosa, ZTE, Huawei, VSOL, TP-Link',
    `model` VARCHAR(100) NOT NULL COMMENT 'Rocket Prism 5AC, LiteBeam 5AC, CCR2004, ZTE C320, etc.',
    `mac_address` VARCHAR(17) NOT NULL COMMENT 'Formato AA:BB:CC:DD:EE:FF',
    `ip_address` VARCHAR(45) NOT NULL COMMENT 'IPv4 o IPv6 de gestión',
    `frequency_mhz` INT UNSIGNED NULL COMMENT 'Ej: 2412, 5180, 5800 (NULL si es OLT/Router por fibra)',
    `frequency_band` VARCHAR(32) NULL COMMENT '2.4 GHz, 5 GHz, 6 GHz, 60 GHz, Fibra Óptica, Ethernet',
    `ssid` VARCHAR(80) NULL COMMENT 'SSID inalámbrico si es AP, CPE o PTP',
    `channel_width_mhz` SMALLINT UNSIGNED NULL COMMENT '20, 40, 80, 160 MHz',
    `signal_dbm` DECIMAL(5,2) NULL COMMENT 'Nivel de señal RSSI o potencia óptica dBm',
    `firmware_version` VARCHAR(50) NULL,
    `physical_location` VARCHAR(200) NOT NULL COMMENT 'Torre Norte, Nodo Central, Casa Cliente, etc.',
    `gps_lat` DECIMAL(10,7) NOT NULL COMMENT 'Latitud GPS WGS84',
    `gps_lng` DECIMAL(10,7) NOT NULL COMMENT 'Longitud GPS WGS84',
    `customer_id` INT UNSIGNED NULL COMMENT 'Cliente asociado si es un CPE u ONU/Router domiciliario',
    `parent_device_id` INT UNSIGNED NULL COMMENT 'AP u OLT al que se conecta este dispositivo',
    `status` ENUM('online', 'offline', 'warning', 'maintenance') NOT NULL DEFAULT 'online',
    `last_seen_at` DATETIME NULL,
    `notes` TEXT NULL,
    `created_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    `updated_at` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY `uq_netinv_isp_mac` (`isp_id`, `mac_address`),
    UNIQUE KEY `uq_netinv_isp_ip` (`isp_id`, `ip_address`),
    INDEX `idx_netinv_type` (`isp_id`, `device_type`),
    INDEX `idx_netinv_brand` (`isp_id`, `brand`),
    INDEX `idx_netinv_customer` (`customer_id`),
    INDEX `idx_netinv_gps` (`gps_lat`, `gps_lng`),
    CONSTRAINT `fk_netinv_isp` FOREIGN KEY (`isp_id`) REFERENCES `isps`(`id`) ON DELETE CASCADE,
    CONSTRAINT `fk_netinv_customer` FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON DELETE SET NULL,
    CONSTRAINT `fk_netinv_parent` FOREIGN KEY (`parent_device_id`) REFERENCES `network_inventory`(`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- La instalación arranca SIN datos de ejemplo. Registra tus equipos reales
-- desde la aplicación (Inventario de Red) o vía importación CSV/JSON.

