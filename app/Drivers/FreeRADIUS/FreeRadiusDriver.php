<?php
declare(strict_types=1);

namespace App\Drivers\FreeRADIUS;

use RuntimeException;
use InvalidArgumentException;

/**
 * Driver para FreeRADIUS (PPPoE, Hotspot, 802.1X, MAC Auth)
 * Usa API REST de FreeRADIUS (freeradius-rest) o consultas directas a BD
 */
final class FreeRadiusDriver
{
    private string $baseUrl;
    private string $username;
    private string $password;
    private string $database;
    private int $timeout;

    public function __construct(array $config)
    {
        $this->baseUrl   = rtrim($config['base_url'] ?? 'http://localhost:3000', '/'); // freeradius-rest API
        $this->username  = $config['username'] ?? 'admin';
        $this->password  = $config['password'] ?? '';
        $this->database  = $config['database'] ?? 'radius';
        $this->timeout   = (int) ($config['timeout'] ?? 10);
    }

    // ============================================================
    // AUTENTICACIÓN Y CONEXIÓN
    // ============================================================

    private function getAuthHeader(): string
    {
        return 'Basic ' . base64_encode($this->username . ':' . $this->password);
    }

    private function request(string $method, string $endpoint, array $body = []): array
    {
        $url = $this->baseUrl . $endpoint;

        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
            'Authorization: ' . $this->getAuthHeader(),
        ];

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => false, // FreeRADIUS REST suele ser HTTP local
        ]);

        if (in_array($method, ['POST', 'PUT', 'PATCH']) && $body !== []) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($error !== '') {
            throw new RuntimeException("FreeRADIUS cURL error: {$error}");
        }

        $decoded = json_decode($response, true);

        if ($httpCode >= 400) {
            $msg = $decoded['message'] ?? $decoded['error'] ?? "HTTP {$httpCode}";
            throw new RuntimeException("FreeRADIUS API error ({$httpCode}): {$msg}");
        }

        return $decoded ?? ['success' => true];
    }

    // ============================================================
    // USUARIOS RADCHECK / RADREPLY (PPPoE, Hotspot, 802.1X)
    // ============================================================

    /**
     * Crea/actualiza usuario en radcheck (autenticación)
     */
    public function setUserCredentials(string $username, string $password, string $authType = 'Cleartext-Password'): bool
    {
        $this->request('DELETE', "/api/radcheck/{$username}");

        $this->request('POST', '/api/radcheck', [
            'username'  => $username,
            'attribute' => $authType,
            'op'        => ':=',
            'value'     => $password,
        ]);
        return true;
    }

    /**
     * Configura atributos de respuesta en radreply (autorización)
     */
    public function setUserReplyAttributes(string $username, array $attributes): bool
    {
        // Limpiar atributos existentes
        $this->request('DELETE', "/api/radreply/{$username}");

        foreach ($attributes as $attr) {
            $this->request('POST', '/api/radreply', array_merge([
                'username' => $username,
            ], $attr));
        }
        return true;
    }

    /**
     * Crea usuario PPPoE completo con perfil
     */
    public function createPppoeUser(string $username, string $password, string $profileName): bool
    {
        $profile = $this->getProfile($profileName);
        if ($profile === null) {
            throw new InvalidArgumentException("Perfil no encontrado: {$profileName}");
        }

        // 1. Credenciales
        $this->setUserCredentials($username, $password);

        // 2. Atributos de autorización basados en perfil
        $replyAttrs = [
            ['attribute' => 'Mikrotik-Rate-Limit', 'op' => ':=', 'value' => $profile['rate_limit'] ?? '10M/50M'],
        ];

        if (!empty($profile['address_list'])) {
            $replyAttrs[] = ['attribute' => 'Mikrotik-Address-List', 'op' => ':=', 'value' => $profile['address_list']];
        }

        if (!empty($profile['vlan_id'])) {
            $replyAttrs[] = ['attribute' => 'Tunnel-Type', 'op' => ':=', 'value' => 'VLAN'];
            $replyAttrs[] = ['attribute' => 'Tunnel-Medium-Type', 'op' => ':=', 'value' => 'IEEE-802'];
            $replyAttrs[] = ['attribute' => 'Tunnel-Private-Group-Id', 'op' => ':=', 'value' => (string) $profile['vlan_id']];
        }

        if (!empty($profile['framed_ip'])) {
            $replyAttrs[] = ['attribute' => 'Framed-IP-Address', 'op' => ':=', 'value' => $profile['framed_ip']];
        }

        if (!empty($profile['ipv6_prefix'])) {
            $replyAttrs[] = ['attribute' => 'Framed-IPv6-Prefix', 'op' => ':=', 'value' => $profile['ipv6_prefix']];
            $replyAttrs[] = ['attribute' => 'Delegated-IPv6-Prefix', 'op' => ':=', 'value' => $profile['ipv6_prefix']];
        }

        if (!empty($profile['session_timeout'])) {
            $replyAttrs[] = ['attribute' => 'Session-Timeout', 'op' => ':=', 'value' => (string) $profile['session_timeout']];
        }

        if (!empty($profile['idle_timeout'])) {
            $replyAttrs[] = ['attribute' => 'Idle-Timeout', 'op' => ':=', 'value' => (string) $profile['idle_timeout']];
        }

        if (!empty($profile['interim_update'])) {
            $replyAttrs[] = ['attribute' => 'Acct-Interim-Interval', 'op' => ':=', 'value' => (string) $profile['interim_update']];
        }

        // Atributos personalizados del perfil
        if (!empty($profile['radius_attributes'])) {
            $custom = json_decode($profile['radius_attributes'], true);
            if (is_array($custom)) {
                foreach ($custom as $attr => $value) {
                    $replyAttrs[] = ['attribute' => $attr, 'op' => ':=', 'value' => $value];
                }
            }
        }

        $this->setUserReplyAttributes($username, $replyAttrs);

        return true;
    }

    /**
     * Elimina usuario completo (radcheck + radreply + radusergroup)
     */
    public function deleteUser(string $username): bool
    {
        $this->request('DELETE', "/api/radcheck/{$username}");
        $this->request('DELETE', "/api/radreply/{$username}");
        $this->request('DELETE', "/api/radusergroup/{$username}");
        return true;
    }

    /**
     * Suspende/Reactiva usuario
     */
    public function setUserStatus(string $username, bool $enabled): bool
    {
        // En FreeRADIUS se puede deshabilitar agregando Simultaneous-Use := 0
        // o cambiando la contraseña a algo inválido
        if ($enabled) {
            // Reactivar: asegurar que Simultaneous-Use no sea 0
            $this->request('DELETE', "/api/radreply/{$username}/attribute/Simultaneous-Use");
        } else {
            // Suspender: Simultaneous-Use := 0
            $this->request('POST', '/api/radreply', [
                'username'  => $username,
                'attribute' => 'Simultaneous-Use',
                'op'        => ':=',
                'value'     => '0',
            ]);
        }
        return true;
    }

    // ============================================================
    // PERFILES
    // ============================================================

    /**
     * Obtiene perfil por nombre
     */
    public function getProfile(string $name): ?array
    {
        try {
            return $this->request('GET', "/api/profiles/{$name}");
        } catch (\Throwable) {
            return null;
        }
    }

    /**
     * Lista todos los perfiles
     */
    public function listProfiles(): array
    {
        return $this->request('GET', '/api/profiles');
    }

    /**
     * Crea/actualiza perfil RADIUS
     */
    public function saveProfile(array $profile): bool
    {
        $this->request('POST', '/api/profiles', $profile);
        return true;
    }

    // ============================================================
    // SESIONES ACTIVAS (radacct)
    // ============================================================

    /**
     * Obtiene sesiones activas
     */
    public function getActiveSessions(array $filters = []): array
    {
        $query = http_build_query($filters);
        return $this->request('GET', '/api/radacct/active?' . $query);
    }

    /**
     * Desconecta sesión activa (CoA - Change of Authorization)
     */
    public function disconnectSession(string $username, string $nasIp = ''): bool
    {
        $body = ['username' => $username];
        if ($nasIp !== '') {
            $body['nas_ip'] = $nasIp;
        }
        $this->request('POST', '/api/coa/disconnect', $body);
        return true;
    }

    // ============================================================
    // GRUPOS DE USUARIOS (radusergroup)
    // ============================================================

    public function assignUserToGroup(string $username, string $groupName, int $priority = 1): bool
    {
        $this->request('POST', '/api/radusergroup', [
            'username'  => $username,
            'groupname' => $groupName,
            'priority'  => $priority,
        ]);
        return true;
    }

    public function removeUserFromGroup(string $username, string $groupName): bool
    {
        $this->request('DELETE', "/api/radusergroup/{$username}/{$groupName}");
        return true;
    }

    // ============================================================
    // ESTADÍSTICAS Y CONTABILIDAD
    // ============================================================

    public function getUserStats(string $username, string $period = 'month'): array
    {
        $query = http_build_query(['period' => $period]);
        return $this->request('GET', "/api/stats/user/{$username}?{$query}");
    }

    public function getGlobalStats(): array
    {
        return $this->request('GET', '/api/stats/global');
    }

    // ============================================================
    // HEALTH CHECK
    // ============================================================

    public function testConnection(): array
    {
        try {
            $result = $this->request('GET', '/api/health');
            return ['ok' => true, 'message' => 'FreeRADIUS API conectado', 'data' => $result];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => $e->getMessage()];
        }
    }
}