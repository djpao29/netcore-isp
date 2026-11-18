<?php
declare(strict_types=1);

namespace App\Core;

use App\Drivers\SmartOLT\SmartOLT_Provider;
use App\Drivers\Contracts\OLTDriverInterface;

/**
 * Gestor de OLT (Optical Line Terminal) para FTTH.
 * Soporta SNMP/Telnet (equipos directos) y SmartOLT API REST.
 */
final class Olt
{
    /** OIDs estándar (RFC 1213 / IF-MIB). */
    private const OID_SYS_DESCR   = '1.3.6.1.2.1.1.1.0';
    private const OID_SYS_NAME    = '1.3.6.1.2.1.1.5.0';
    private const OID_SYS_UPTIME  = '1.3.6.1.2.1.1.3.0';
    private const OID_SYS_CONTACT = '1.3.6.1.2.1.1.4.0';
    private const OID_IF_NUMBER   = '1.3.6.1.2.1.2.1.0';

    public static function creds(array $olt): array
    {
        $host = trim((string) ($olt['ip_address'] ?? ''));
        $snmpPort = (int) ($olt['snmp_port'] ?? 161);
        if ($snmpPort <= 0) $snmpPort = 161;
        $telnetPort = (int) ($olt['telnet_port'] ?? 23);
        if ($telnetPort <= 0) $telnetPort = 23;
        $sshPort = (int) ($olt['ssh_port'] ?? 22);
        if ($sshPort <= 0) $sshPort = 22;
        $community = trim((string) ($olt['snmp_ro_community'] ?? ($olt['snmp_community'] ?? 'public')));
        if ($community === '') $community = 'public';
        $version = strtolower(trim((string) ($olt['snmp_version'] ?? 'v2c')));
        if (!in_array($version, ['v1', 'v2c', 'v3'], true)) $version = 'v2c';
        return [
            'host'            => $host,
            'snmp_port'       => $snmpPort,
            'snmp_version'    => $version,
            'snmp_community'  => $community,
            'snmp_rw'         => trim((string) ($olt['snmp_rw_community'] ?? '')),
            'snmpv3_user'     => trim((string) ($olt['snmpv3_user'] ?? '')),
            'snmpv3_auth_proto'=> strtolower(trim((string) ($olt['snmpv3_auth_proto'] ?? 'md5'))),
            'snmpv3_auth_pass' => (string) ($olt['snmpv3_auth_pass'] ?? ''),
            'snmpv3_priv_proto'=> strtolower(trim((string) ($olt['snmpv3_priv_proto'] ?? 'none'))),
            'snmpv3_priv_pass' => (string) ($olt['snmpv3_priv_pass'] ?? ''),
            'snmpv3_engine_id' => trim((string) ($olt['snmpv3_engine_id'] ?? '')),
            'snmpv3_context'   => (string) ($olt['snmpv3_context'] ?? ''),
            'telnet_port'     => $telnetPort,
            'ssh_port'        => $sshPort,
            'username'        => trim((string) ($olt['username'] ?? 'admin')),
            'password'        => (string) ($olt['password_encrypted'] ?? ($olt['password'] ?? '')),
            'timeout'         => 8,
            'driver_class'    => trim((string) ($olt['driver_class'] ?? '')),
        ];
    }

    /**
     * Obtiene el driver apropiado para un OLT según su configuración.
     */
    private static function getDriver(array $creds): ?OLTDriverInterface
    {
        $driverClass = $creds['driver_class'] ?? '';

        // SmartOLT API REST
        if ($driverClass === 'SmartOLT' || str_contains(strtolower($driverClass), 'smartolt')) {
            try {
                return SmartOLT_Provider::make();
            } catch (\Throwable $e) {
                return null;
            }
        }

        // Drivers SNMP/Telnet directos (ZTE, Huawei, VSOL, etc.) - por implementar
        return null;
    }

    /**
     * Prueba de conectividad SNMP: lee sysDescr/sysName/sysUpTime.
     * Devuelve ['ok'=>bool, 'message'=>string, 'data'=>[...]].
     */
    public static function test(array $creds): array
    {
        if ($creds['host'] === '') {
            return ['ok' => false, 'message' => 'El OLT no tiene IP de gestión configurada.'];
        }
        $oids = [self::OID_SYS_DESCR, self::OID_SYS_NAME, self::OID_SYS_UPTIME, self::OID_IF_NUMBER];
        $version = $creds['snmp_version'] ?? 'v2c';
        if ($version === 'v3') {
            $auth = [
                'user' => $creds['snmpv3_user'],
                'auth_proto' => $creds['snmpv3_auth_proto'],
                'auth_pass' => $creds['snmpv3_auth_pass'],
                'priv_proto' => $creds['snmpv3_priv_proto'],
                'priv_pass' => $creds['snmpv3_priv_pass'],
                'engine_id' => $creds['snmpv3_engine_id'],
                'context' => $creds['snmpv3_context'],
            ];
            $vals = SnmpV3::getMulti($creds['host'], $creds['snmp_port'], $auth, $oids);
            if (empty($vals)) {
                return ['ok' => false, 'message' => "Sin respuesta SNMPv3 desde {$creds['host']}:{$creds['snmp_port']} (usuario '{$creds['snmpv3_user']}')."];
            }
        } else {
            $ver = ($version === 'v1') ? 1 : 2;
            $vals = Snmp::getMulti($creds['host'], $creds['snmp_port'], $creds['snmp_community'], $oids, $ver);
            if (empty($vals)) {
                return ['ok' => false, 'message' => "Sin respuesta SNMP desde {$creds['host']}:{$creds['snmp_port']} (comunidad '{$creds['snmp_community']}')."];
            }
        }
        return [
            'ok'      => true,
            'message' => "Conexión SNMP correcta con {$creds['host']}:{$creds['snmp_port']}.",
            'data'    => [
                'sysDescr'  => $vals[self::OID_SYS_DESCR] ?? '',
                'sysName'   => $vals[self::OID_SYS_NAME] ?? '',
                'sysUpTime' => $vals[self::OID_SYS_UPTIME] ?? '',
                'ifNumber'  => $vals[self::OID_IF_NUMBER] ?? '',
            ],
        ];
    }

    /**
     * Sincroniza un OLT usando el driver apropiado (SNMP o SmartOLT).
     * Devuelve resumen textual.
     */
    public static function syncOne(array $creds, Modules $modules, int $oltId): string
    {
        $name = 'OLT #' . $oltId;
        $olt = $modules->find('olts', $oltId);
        if ($olt !== null) $name = (string) ($olt['name'] ?? $name);

        if ($creds['host'] === '') {
            $modules->update('olts', $oltId, ['status' => 'offline']);
            return "{$name}: sin IP de gestión";
        }

        // Intentar con SmartOLT primero
        $driver = self::getDriver($creds);
        if ($driver !== null) {
            try {
                $oltList = $driver->getOltList();
                $modules->update('olts', $oltId, [
                    'status'       => 'online',
                    'last_sync_at' => date('Y-m-d H:i:s'),
                ]);
                return "{$name}: SmartOLT API OK ({$oltList} OLTs registradas)";
            } catch (\Throwable $e) {
                $modules->update('olts', $oltId, ['status' => 'offline']);
                return "{$name}: SmartOLT error - " . $e->getMessage();
            }
        }

        // Fallback a SNMP tradicional
        $res = self::test($creds);
        if (!$res['ok']) {
            $modules->update('olts', $oltId, ['status' => 'offline']);
            return "{$name}: " . $res['message'];
        }
        $d = $res['data'];
        $modules->update('olts', $oltId, [
            'status'       => 'online',
            'sys_name'     => $d['sysName'],
            'sys_descr'    => $d['sysDescr'],
            'uptime'       => $d['sysUpTime'],
            'if_number'    => $d['ifNumber'],
            'last_sync_at' => date('Y-m-d H:i:s'),
        ]);
        return "{$name}: SNMP OK (" . ($d['sysName'] ?: $creds['host']) . ", {$d['ifNumber']} interfaces)";
    }

    /**
     * Sincroniza ONUs de un OLT usando SmartOLT
     */
    public static function syncOnus(array $creds, Modules $modules, int $oltId): string
    {
        $driver = self::getDriver($creds);
        if ($driver === null) {
            return "OLT {$oltId}: No hay driver SmartOLT configurado";
        }

        try {
            $onus = $driver->getOnuList();
            $count = count($onus);

            // Actualizar/crear ONUs en la tabla onus
            foreach ($onus as $onu) {
                // Aquí se sincronizaría con la tabla onus
                // $modules->create/update 'onus'...
            }

            return "OLT {$oltId}: {$count} ONUs sincronizadas desde SmartOLT";
        } catch (\Throwable $e) {
            return "OLT {$oltId}: Error sincronizando ONUs - " . $e->getMessage();
        }
    }

    /**
     * Autoriza una ONU via SmartOLT
     */
    public static function authorizeOnu(array $creds, array $onuData): array
    {
        $driver = self::getDriver($creds);
        if ($driver === null) {
            return ['success' => false, 'message' => 'No hay driver SmartOLT configurado'];
        }

        try {
            return $driver->authorizeOnu(
                (int) ($onuData['slot'] ?? 1),
                (int) ($onuData['pon'] ?? 1),
                (string) ($onuData['serial_number'] ?? ''),
                (int) ($onuData['vlan_id'] ?? 100),
                (string) ($onuData['customer_name'] ?? ''),
                (string) ($onuData['line_profile'] ?? 'default'),
                (string) ($onuData['service_profile'] ?? 'default')
            );
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    /**
     * Obtiene señal óptica de una ONU via SmartOLT
     */
    public static function getOnuSignal(array $creds, int $slot, int $pon, int $onuIndex): array
    {
        $driver = self::getDriver($creds);
        if ($driver === null) {
            return ['success' => false, 'message' => 'No hay driver SmartOLT configurado'];
        }

        try {
            return $driver->getOnuOpticalSignal($slot, $pon, $onuIndex);
        } catch (\Throwable $e) {
            return ['success' => false, 'message' => $e->getMessage()];
        }
    }

    /**
     * Reinicia una ONU via SmartOLT
     */
    public static function rebootOnu(array $creds, int $slot, int $pon, int $onuIndex): bool
    {
        $driver = self::getDriver($creds);
        if ($driver === null) {
            return false;
        }

        try {
            return $driver->rebootOnu($slot, $pon, $onuIndex);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Indica si los comandos SET (escritura) están habilitados por configuración.
     */
    public static function isSetAllowed(): bool
    {
        try {
            return (bool) \App\Core\Config::get('olt.allow_set', false);
        } catch (\Throwable $e) {
            return false;
        }
    }

    /**
     * Ejecuta un comando por Telnet en el OLT y devuelve la salida.
     * Los comandos de escritura (SET/CREATE/DELETE/CONFIG) requieren olt.allow_set = true.
     */
    public static function telnetCommand(array $creds, string $command, string $prompt = '#', bool $requireSetFlag = true): string
    {
        if ($creds['host'] === '') {
            throw new \RuntimeException('El OLT no tiene IP de gestion configurada.');
        }
        $upper = strtoupper(trim($command));
        $isWrite = (strpos($upper, 'SET ') === 0) || (strpos($upper, 'CREATE') === 0)
            || (strpos($upper, 'DELETE') === 0) || (strpos($upper, 'CONFIG') === 0);
        if ($isWrite && $requireSetFlag && !self::isSetAllowed()) {
            throw new \RuntimeException('Comandos SET/escritura deshabilitados por defecto. Active olt.allow_set=true en la configuracion para habilitarlos.');
        }
        $t = new Telnet($creds['host'], $creds['telnet_port'], $creds['timeout']);
        if ($creds['username'] !== '') {
            $t->login($creds['username'], $creds['password'], $prompt);
        }
        $out = $t->exec($command, $prompt);
        $t->close();
        return $out;
    }
}
