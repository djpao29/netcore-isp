<?php
declare(strict_types=1);

namespace App\Core;

use RuntimeException;

/**
 * Cliente REAL de la API de MikroTik RouterOS en PHP.
 *
 * Implementa el protocolo binario de RouterOS (puertos 8728 / 8729 TLS):
 * palabras con longitud codificada, login con reto MD5 (RouterOS < 6.43) y
 * lectura de sentencias !re / !done / !trap / !fatal. No es simulado: abre un
 * socket TCP/TLS real contra el equipo; si no es alcanzable o las credenciales
 * son incorrectas, devuelve el error real.
 */
final class Mikrotik
{
    /** @var resource|null */
    private $socket = null;

    private function __construct(private array $creds) {}

    public static function connect(array $creds): self
    {
        $creds = array_merge(
            ['host' => '', 'port' => 8728, 'user' => 'admin', 'password' => '', 'tls' => false, 'timeout' => 8],
            $creds
        );
        $client = new self($creds);
        $client->open();
        $client->login();
        return $client;
    }

    private function open(): void
    {
        $scheme = $this->creds['tls'] ? 'ssl' : 'tcp';
        $remote = $scheme . '://' . $this->creds['host'] . ':' . (int) $this->creds['port'];
        $context = stream_context_create(
            $this->creds['tls'] ? ['ssl' => ['verify_peer' => false, 'verify_peer_name' => false]] : []
        );

        $errno = 0;
        $errstr = '';
        $socket = @stream_socket_client(
            $remote,
            $errno,
            $errstr,
            (float) $this->creds['timeout'],
            STREAM_CLIENT_CONNECT,
            $context
        );

        if ($socket === false) {
            throw new RuntimeException(
                "No se pudo conectar a {$this->creds['host']}:{$this->creds['port']} ($errstr)"
            );
        }

        stream_set_timeout($socket, (int) $this->creds['timeout']);
        $this->socket = $socket;
    }

    // --- Codificación de longitud de palabra (protocolo RouterOS) ------------
    private static function encodeLength(int $len): string
    {
        if ($len < 0x80) {
            return chr($len);
        }
        if ($len < 0x4000) {
            return chr(($len >> 8) | 0x80) . chr($len & 0xFF);
        }
        if ($len < 0x200000) {
            return chr(($len >> 16) | 0xC0) . chr(($len >> 8) & 0xFF) . chr($len & 0xFF);
        }
        if ($len < 0x10000000) {
            return chr(($len >> 24) | 0xE0) . chr(($len >> 16) & 0xFF) . chr(($len >> 8) & 0xFF) . chr($len & 0xFF);
        }
        return chr(0xF0) . pack('N', $len);
    }

    private function write(array $words): void
    {
        $payload = '';
        foreach ($words as $word) {
            $word    = (string) $word;
            $payload .= self::encodeLength(strlen($word)) . $word;
        }
        $payload .= self::encodeLength(0);
        fwrite($this->socket, $payload);
    }

    private function readLength(): int
    {
        $b0 = ord($this->readBytes(1));
        if (($b0 & 0x80) === 0) {
            return $b0;
        }
        if (($b0 & 0xC0) === 0x80) {
            return (($b0 & 0x3F) << 8) | ord($this->readBytes(1));
        }
        if (($b0 & 0xE0) === 0xC0) {
            $u = unpack('n', $this->readBytes(2));
            return (($b0 & 0x1F) << 16) | $u[1];
        }
        if (($b0 & 0xF0) === 0xE0) {
            $u = unpack('N', "\x00" . $this->readBytes(3));
            return (($b0 & 0x0F) << 24) | $u[1];
        }
        if ($b0 === 0xF0) {
            $u = unpack('N', $this->readBytes(4));
            return $u[1];
        }
        throw new RuntimeException('Longitud inválida en el protocolo RouterOS.');
    }

    private function readBytes(int $n): string
    {
        $data = '';
        while (strlen($data) < $n) {
            $chunk = fread($this->socket, $n - strlen($data));
            if ($chunk === false || $chunk === '') {
                $meta = stream_get_meta_data($this->socket);
                if (!empty($meta['timed_out'])) {
                    throw new RuntimeException('El router no respondió a tiempo.');
                }
                throw new RuntimeException('El router cerró la conexión.');
            }
            $data .= $chunk;
        }
        return $data;
    }

    private function readSentence(): array
    {
        $words = [];
        while (true) {
            $len = $this->readLength();
            if ($len === 0) {
                break;
            }
            $words[] = $this->readBytes($len);
        }
        return $words;
    }

    private function login(): void
    {
        $this->write(['/login', '=name=' . $this->creds['user'], '=password=' . $this->creds['password']]);
        $sentence = $this->readSentence();

        $ret = null;
        foreach ($sentence as $word) {
            if (str_starts_with($word, '=ret=')) {
                $ret = substr($word, 5);
            }
        }

        if ($ret !== null) {
            $challenge = hex2bin($ret) ?: '';
            $digest    = md5($challenge . $this->creds['password']);
            $this->write(['/login', '=name=' . $this->creds['user'], '=response=00' . $digest]);
            $sentence = $this->readSentence();
        }

        $tag = $sentence[0] ?? '';
        if ($tag === '!trap' || $tag === '!fatal') {
            $msg = self::wordValue($sentence, 'message') ?? 'credenciales rechazadas';
            throw new RuntimeException("Autenticación fallida en {$this->creds['host']}: {$msg}");
        }
        if ($tag !== '!done') {
            throw new RuntimeException('Respuesta de login inesperada del router.');
        }
    }

    /**
     * Ejecuta un comando y recolecta las filas !re hasta !done/!trap.
     *
     * @return array{rows: array<int, array<int, string>>, trapped?: string, done: bool}
     */
    public function talk(array $words): array
    {
        $this->write($words);
        $rows = [];
        while (true) {
            $sentence = $this->readSentence();
            $tag      = $sentence[0] ?? '';
            if ($tag === '!re') {
                $rows[] = $sentence;
                continue;
            }
            if ($tag === '!trap') {
                return ['rows' => $rows, 'trapped' => self::wordValue($sentence, 'message') ?? 'error', 'done' => false];
            }
            if ($tag === '!fatal') {
                throw new RuntimeException(self::wordValue($sentence, 'message') ?? 'error fatal del router');
            }
            if ($tag === '!done') {
                return ['rows' => $rows, 'done' => true];
            }
        }
    }

    public function close(): void
    {
        if ($this->socket) {
            @fclose($this->socket);
            $this->socket = null;
        }
    }

    private static function wordValue(array $sentence, string $key): ?string
    {
        $prefix = "={$key}=";
        foreach ($sentence as $word) {
            if (str_starts_with($word, $prefix)) {
                return substr($word, strlen($prefix));
            }
        }
        return null;
    }

    // ==================================================================
    //  Herramientas por nombre (equivalen a mikrotik.ts)
    // ==================================================================
    public static function buildCommand(string $tool, string $routerName): array
    {
        $safe  = substr(preg_replace('/[^a-zA-Z0-9_-]/', '_', $routerName) ?? 'router', 0, 24);
        $stamp = gmdate('Y-m-d-Hi');

        return match ($tool) {
            'ping'         => [['/ping', '=address=8.8.8.8', '=count=4'], 'Ping desde el router hacia 8.8.8.8'],
            'log'          => [['/log/print'], null],
            'ppp-active'   => [['/ppp/active/print'], null],
            'arp'          => [['/ip/arp/print'], null],
            'dhcp-leases'  => [['/ip/dhcp-server/lease/print'], null],
            'ip-bindings'  => [['/ip/hotspot/ip-binding/print'], null],
            'address-list' => [['/ip/firewall/address-list/print'], null],
            'pool-ipv6'    => [['/ipv6/pool/print'], null],
            'torch'        => [['/interface/print', '=.proplist=name,type,running,rx-byte,tx-byte'], 'Estadísticas de interfaces'],
            'backup'       => [['/system/backup/save', "=name=backup-{$safe}-{$stamp}"], 'Respaldo creado en el equipo (Files)'],
            'reboot'       => [['/system/reboot'], 'El equipo se reiniciará y cerrará la conexión'],
            'resource'     => [['/system/resource/print'], null],
            'identity'     => [['/system/identity/print'], null],
            default        => throw new RuntimeException("Herramienta no reconocida: {$tool}"),
        };
    }

    public static function formatRows(array $rows): string
    {
        if ($rows === []) {
            return '(sin filas devueltas por el router)';
        }
        $lines = [];
        foreach ($rows as $row) {
            $parts = [];
            foreach ($row as $word) {
                if (str_starts_with($word, '=.id=') || str_starts_with($word, '=#')) {
                    continue;
                }
                $clean = ltrim($word, '=');
                $eq    = strpos($clean, '=');
                $parts[] = $eq === false ? $clean : substr($clean, 0, $eq) . ': ' . substr($clean, $eq + 1);
            }
            $lines[] = implode(' | ', array_filter($parts, static fn ($p) => $p !== ''));
        }
        return implode("\n", $lines);
    }

    /**
     * @return array{tool: string, command: string, text: string, rows: int, note: ?string}
     */
    public static function runTool(array $creds, string $tool, string $routerName): array
    {
        [$words, $note] = self::buildCommand($tool, $routerName);
        $client = self::connect($creds);
        try {
            $result = $client->talk($words);
            if (!empty($result['trapped'])) {
                throw new RuntimeException('RouterOS respondió con error: ' . $result['trapped']);
            }
            $body = self::formatRows($result['rows']);
            return [
                'tool'    => $tool,
                'command' => implode(' ', $words),
                'rows'    => count($result['rows']),
                'note'    => $note,
                'text'    => ($note !== null ? "# {$note}\n" : '') . '$ ' . implode(' ', $words) . "\n\n" . $body,
            ];
        } finally {
            $client->close();
        }
    }

    /**
     * @return array{ok: bool, message: string, identity?: ?string, version?: ?string, uptime?: ?string, board?: ?string, cpu_load?: ?string, free_memory?: ?string}
     */
    public static function test(array $creds): array
    {
        try {
            $client = self::connect($creds);
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => "No se pudo conectar/autenticar en {$creds['host']}: " . $e->getMessage()];
        }

        try {
            $identity = $client->talk(['/system/identity/print']);
            $resource = $client->talk(['/system/resource/print']);
            $pick = static function (array $rows, string $key): ?string {
                $row = $rows[0] ?? [];
                return self::wordValue($row, $key);
            };
            return [
                'ok'          => true,
                'identity'    => $pick($identity['rows'], 'name'),
                'version'     => $pick($resource['rows'], 'version'),
                'uptime'      => $pick($resource['rows'], 'uptime'),
                'board'       => $pick($resource['rows'], 'board-name'),
                'cpu_load'    => $pick($resource['rows'], 'cpu-load'),
                'free_memory' => $pick($resource['rows'], 'free-memory'),
                'message'     => "Conexión correcta con {$creds['host']}:{$creds['port']}.",
            ];
        } catch (\Throwable $e) {
            return ['ok' => false, 'message' => 'Conectado pero la consulta falló: ' . $e->getMessage()];
        } finally {
            $client->close();
        }
    }

    /**
     * Habilita/deshabilita un secreto PPPoE real (cortes y reconexiones).
     *
     * @return array{ok: bool, message: string}
     */
    public static function setPppoeEnabled(array $creds, string $username, bool $enabled): array
    {
        $client = self::connect($creds);
        try {
            $found = $client->talk(['/ppp/secret/print', "?name={$username}"]);
            $row   = $found['rows'][0] ?? [];
            $id    = self::wordValue($row, '.id');
            if ($id === null) {
                return ['ok' => false, 'message' => "No existe el secreto PPPoE \"{$username}\" en el router."];
            }

            $set = $client->talk(['/ppp/secret/set', "=.id={$id}", '=disabled=' . ($enabled ? 'no' : 'yes')]);
            if (!empty($set['trapped'])) {
                return ['ok' => false, 'message' => $set['trapped']];
            }

            if (!$enabled) {
                $active   = $client->talk(['/ppp/active/print', "?name={$username}"]);
                $activeId = self::wordValue($active['rows'][0] ?? [], '.id');
                if ($activeId !== null) {
                    $client->talk(['/ppp/active/remove', "=.id={$activeId}"]);
                }
            }

            return [
                'ok'      => true,
                'message' => "Secreto PPPoE \"{$username}\" " . ($enabled ? 'habilitado' : 'deshabilitado') . ' en el router.',
            ];
        } finally {
            $client->close();
        }
    public static function driver(array $router): MikrotikDriverInterface
    {
        $creds = Routers::creds($router);
        return new \App\Drivers\Mikrotik\RouterOSApiDriver(
            $creds['host'],
            $creds['port'],
            $creds['user'],
            $creds['password'],
            $creds['tls'] ?? false
        );
    }
}
