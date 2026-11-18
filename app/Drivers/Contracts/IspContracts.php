<?php
declare(strict_types=1);

namespace App\Drivers\Contracts;

/**
 * 1. MIKROTIK ROUTEROS DRIVER INTERFACE
 * Credenciales requeridas: IP/Host, Puerto API (8728/8729 o 443 REST v7), Usuario con grupo 'full' o 'write+api', Contraseña.
 */
interface MikrotikDriverInterface
{
    public function connect(string $ip, int $port, string $username, string $password, bool $useSsl = false): bool;
    public function disconnect(): void;
    public function getSystemResources(): array;
    public function getInterfacesTraffic(): array;
    public function createPppoeSecret(string $username, string $password, string $profile, string $remoteAddress = '', string $comment = ''): bool;
    public function suspendPppoeUser(string $username, string $morosoProfile = 'CORTADOS_MOROSOS', string $addressList = 'MOROSOS_ISP'): bool;
    public function reactivatePppoeUser(string $username, string $activeProfile): bool;
    public function syncSimpleQueue(string $name, string $targetIp, string $maxLimitUp, string $maxLimitDown, string $priority = '8/8'): bool;
}

/**
 * 2. OLT FTTH DRIVER INTERFACE (ZTE, Huawei, VSOL, FiberHome, C-Data, TP-Link, HSGQ, Wolck)
 * Credenciales requeridas: IP Gestión, Puerto Telnet/SSH (23/22), Usuario/Password admin, Comunidad SNMP RO/RW (161).
 */
interface OLTDriverInterface
{
    public function getManufacturer(): string;
    public function discoverUnconfiguredOnus(): array;
    public function authorizeOnu(int $slot, int $pon, string $serialNumber, int $vlanId, string $customerName, string $lineProfile, string $srvProfile): array;
    public function getOnuOpticalSignal(int $slot, int $pon, int $onuIndex): array;
    public function rebootOnu(int $slot, int $pon, int $onuIndex): bool;
}

/**
 * 2b. SMARTOLT DRIVER INTERFACE (API REST - https://api.smartolt.com/)
 * Extiende OLTDriverInterface con métodos específicos de SmartOLT.
 * Credenciales: API Key + API Secret (panel SmartOLT > Integraciones).
 */
interface SmartOLTDriverInterface extends OLTDriverInterface
{
    public function getOnuList(array $filters = []): array;
    public function getOnuDetail(string $onuId): array;
    public function deleteOnu(string $onuId): bool;
    public function updateOnuSpeedProfile(string $onuId, string $lineProfile, string $srvProfile): bool;
    public function getOltList(): array;
    public function getOltPorts(string $oltId): array;
}

/**
 * 3. WHATSAPP PROVIDER INTERFACE (Meta Cloud API Oficial, Evolution API, UltraMsg, Wati)
 * Credenciales requeridas: Endpoint URL, Bearer Access Token / API Key, Phone Number ID / Instance Name, Webhook Verify Token.
 */
interface WhatsAppProviderInterface
{
    public function sendTextMessage(string $toPhone, string $messageBody): array;
    public function sendTemplateMessage(string $toPhone, string $templateCode, array $variables): array;
    public function sendDocument(string $toPhone, string $documentUrl, string $caption, string $filename): array;
    public function parseInboundWebhook(array $payload): array;
}

/**
 * 4. PAYMENT GATEWAY INTERFACE (PayPal REST v2, Stripe, Pasarelas Locales)
 * Nunca almacena PAN/CVV de tarjetas en servidores locales.
 */
interface PaymentGatewayInterface
{
    public function getGatewayName(): string;
    public function createCheckoutOrder(int $invoiceId, float $amount, string $currency, string $returnUrl, string $cancelUrl): array;
    public function captureWebhookPayment(array $headers, string $rawBody): array;
}
