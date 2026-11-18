<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Cliente Telnet puro en PHP (sin extensión). Permite conectar a un OLT,
 * autenticarse y ejecutar comandos, leyendo la salida hasta el prompt.
 */
final class Telnet
{
    private $socket = null;
    private string $prompt = '#';
    private int $timeout = 10;

    public function __construct(string $host, int $port = 23, int $timeout = 10)
    {
        $this->timeout = $timeout;
        $fp = @fsockopen($host, $port, $errno, $errstr, $timeout);
        if (!$fp) {
            throw new \RuntimeException("No se pudo conectar a {$host}:{$port} ({$errstr})");
        }
        stream_set_timeout($fp, $timeout);
        $this->socket = $fp;
    }

    public function login(string $username, string $password, string $prompt = '#'): void
    {
        $this->prompt = $prompt;
        // Espera prompt de usuario
        $this->readUntil(['Username:', 'login:', 'User:', '>']);
        $this->write($username);
        $this->readUntil(['Password:', 'password:']);
        $this->write($password);
        $this->readUntil([$prompt, '>', '#', '$']);
    }

    public function exec(string $command, string $prompt = null): string
    {
        $p = $prompt ?? $this->prompt;
        $this->write($command);
        return $this->readUntil([$p]);
    }

    public function write(string $data): void
    {
        fwrite($this->socket, $data . "\n");
        fflush($this->socket);
    }

    public function readUntil(array $prompts, int $timeout = null): string
    {
        $t = $timeout ?? $this->timeout;
        $deadline = microtime(true) + $t;
        $buf = '';
        while (microtime(true) < $deadline) {
            $meta = stream_get_meta_data($this->socket);
            if ($meta['eof']) break;
            $chunk = fread($this->socket, 4096);
            if ($chunk === false) break;
            $buf .= $chunk;
            foreach ($prompts as $p) {
                if ($p !== '' && strpos($buf, $p) !== false) {
                    return $buf;
                }
            }
            if ($chunk === '') {
                usleep(100000);
            }
        }
        return $buf;
    }

    public function close(): void
    {
        if (is_resource($this->socket)) {
            fclose($this->socket);
            $this->socket = null;
        }
    }

    public function __destruct()
    {
        $this->close();
    }
}