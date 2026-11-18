<?php
declare(strict_types=1);

namespace App\Drivers\SmartOLT;

use App\Drivers\Contracts\OLTDriverInterface;
use RuntimeException;
use InvalidArgumentException;

/**
 * Driver para SmartOLT API REST
 *
 * Documentación API: https://api.smartolt.com/
 * Requiere: API Key + Secret (se obtienen en panel SmartOLT > Integraciones)
 */
final class SmartOLT_Driver implements OLTDriverInterface
{
    private string $baseUrl;
    private string $apiKey;
    private string $apiSecret;
    private int $timeout;

    public function __construct(array $config)
    {
        $this->baseUrl     = rtrim($config['base_url'] ?? 'https://api.smartolt.com', '/');
        $this->apiKey      = $config['api_key'] ?? '';
        $this->apiSecret   = $config['api_secret'] ?? '';
        $this->timeout     = (int) ($config['timeout'] ?? 10);

        if ($this->apiKey === '' || $this->apiSecret === '') {
            throw new InvalidArgumentException('SmartOLT requiere api_key y api_secret');
        }
    }

    // ============================================================
    // OLTDriverInterface
    // ============================================================

    public function getManufacturer(): string
    {
        return 'SmartOLT (Multi-vendor: ZTE, Huawei, VSOL, FiberHome, C-Data, TP-Link)';
    }

    public function discoverUnconfiguredOnus(): array
    {
        $response = $this->request('GET', '/api/v1/onu/unconfigured');
        return $this->normalizeOnuList($response['data'] ?? []);
    }

    public function authorizeOnu(
        int $slot,
        int $pon,
        string $serialNumber,
        int $vlanId,
        string $customerName,
        string $lineProfile,
        string $srvProfile
    ): array {
        $payload = [
            'slot'           => $slot,
            'pon'            => $pon,
            'serial'         => $serialNumber,
            'vlan_id'        => $vlanId,
            'name'           => $customerName,
            'line_profile'   => $lineProfile,
            'service_profile'=> $srvProfile,
        ];

        $response = $this->request('POST', '/api/v1/onu/authorize', $payload);

        return [
            'success'     => true,
            'onu_id'      => $response['data']['onu_id'] ?? null,
            'message'     => 'ONU autorizada correctamente en SmartOLT',
            'raw_response'=> $response,
        ];
    }

    public function getOnuOpticalSignal(int $slot, int $pon, int $onuIndex): array
    {
        $response = $this->request('GET', "/api/v1/onu/signal/{$slot}/{$pon}/{$onuIndex}");
        $data = $response['data'] ?? [];

        return [
            'rx_power_dbm'   => (float) ($data['rx_power'] ?? 0),
            'tx_power_dbm'   => (float) ($data['tx_power'] ?? 0),
            'status'         => $data['status'] ?? 'unknown',
            'distance_m'     => (int) ($data['distance'] ?? 0),
            'last_updated'   => $data['updated_at'] ?? date('c'),
            'raw'            => $data,
        ];
    }

    public function rebootOnu(int $slot, int $pon, int $onuIndex): bool
    {
        $response = $this->request('POST', "/api/v1/onu/reboot/{$slot}/{$pon}/{$onuIndex}");
        return ($response['success'] ?? false) === true;
    }

    // ============================================================
    // Métodos adicionales SmartOLT
    // ============================================================

    /**
     * Lista todas las ONUs configuradas
     */
    public function getOnuList(array $filters = []): array
    {
        $query = http_build_query($filters);
        $response = $this->request('GET', '/api/v1/onu/list?' . $query);
        return $this->normalizeOnuList($response['data'] ?? []);
    }

    /**
     * Obtiene detalles de una ONU específica
     */
    public function getOnuDetail(string $onuId): array
    {
        $response = $this->request('GET', "/api/v1/onu/{$onuId}");
        return $response['data'] ?? [];
    }

    /**
     * Elimina/Desautoriza una ONU
     */
    public function deleteOnu(string $onuId): bool
    {
        $response = $this->request('DELETE', "/api/v1/onu/{$onuId}");
        return ($response['success'] ?? false) === true;
    }

    /**
     * Actualiza perfil de velocidad de una ONU
     */
    public function updateOnuSpeedProfile(string $onuId, string $lineProfile, string $srvProfile): bool
    {
        $response = $this->request('PUT', "/api/v1/onu/{$onuId}/profile", [
            'line_profile'   => $lineProfile,
            'service_profile'=> $srvProfile,
        ]);
        return ($response['success'] ?? false) === true;
    }

    /**
     * Obtiene lista de OLTs registradas en SmartOLT
     */
    public function getOltList(): array
    {
        $response = $this->request('GET', '/api/v1/olt/list');
        return $response['data'] ?? [];
    }

    /**
     * Obtiene puertos PON de una OLT
     */
    public function getOltPorts(string $oltId): array
    {
        $response = $this->request('GET', "/api/v1/olt/{$oltId}/ports");
        return $response['data'] ?? [];
    }

    // ============================================================
    // Helpers privados
    // ============================================================

    private function request(string $method, string $endpoint, array $body = []): array
    {
        $url = $this->baseUrl . $endpoint;

        $headers = [
            'Content-Type: application/json',
            'Accept: application/json',
            'X-API-Key: ' . $this->apiKey,
            'X-API-Secret: ' . $this->apiSecret,
        ];

        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_CUSTOMREQUEST  => $method,
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => $this->timeout,
            CURLOPT_CONNECTTIMEOUT => 5,
            CURLOPT_SSL_VERIFYPEER => true,
        ]);

        if (in_array($method, ['POST', 'PUT', 'PATCH']) && $body !== []) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body));
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $error    = curl_error($ch);
        curl_close($ch);

        if ($error !== '') {
            throw new RuntimeException("SmartOLT cURL error: {$error}");
        }

        $decoded = json_decode($response, true);

        if ($httpCode >= 400) {
            $msg = $decoded['message'] ?? $decoded['error'] ?? "HTTP {$httpCode}";
            throw new RuntimeException("SmartOLT API error ({$httpCode}): {$msg}");
        }

        return $decoded ?? ['success' => true];
    }

    private function normalizeOnuList(array $onus): array
    {
        return array_map(function ($onu) {
            return [
                'onu_id'          => $onu['id'] ?? $onu['onu_id'] ?? '',
                'serial_number'   => $onu['serial'] ?? $onu['serial_number'] ?? '',
                'slot'            => (int) ($onu['slot'] ?? 0),
                'pon'             => (int) ($onu['pon'] ?? 0),
                'onu_index'       => (int) ($onu['onu_index'] ?? $onu['id'] ?? 0),
                'status'          => $onu['status'] ?? 'unknown',
                'vlan_id'         => (int) ($onu['vlan_id'] ?? 0),
                'line_profile'    => $onu['line_profile'] ?? '',
                'service_profile' => $onu['service_profile'] ?? '',
                'customer_name'   => $onu['name'] ?? $onu['customer_name'] ?? '',
                'ip_address'      => $onu['ip'] ?? $onu['ip_address'] ?? '',
                'rx_power_dbm'    => isset($onu['rx_power']) ? (float) $onu['rx_power'] : null,
                'tx_power_dbm'    => isset($onu['tx_power']) ? (float) $onu['tx_power'] : null,
                'olt_name'        => $onu['olt_name'] ?? $onu['olt'] ?? '',
                'last_seen'       => $onu['last_seen'] ?? $onu['updated_at'] ?? null,
            ];
        }, $onus);
    }
}