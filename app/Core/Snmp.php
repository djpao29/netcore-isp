<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Cliente SNMP puro en PHP (v1/v2c) sobre UDP, sin extensión snmp.
 * Implementa GET y WALK (GetNext) suficientes para consultar OLTs FTTH.
 */
final class Snmp
{
    /** Timeout por defecto (segundos). */
    private const TIMEOUT = 5;

    /** Realiza un SNMP GET de un OID. Devuelve el valor (string) o null si falla. */
    public static function get(string $host, int $port, string $community, string $oid, int $version = 2, int $timeout = self::TIMEOUT): ?string
    {
        $vals = self::getMulti($host, $port, $community, [$oid], $version, $timeout);
        return $vals[$oid] ?? null;
    }

    /** SNMP GET de varios OIDs a la vez. Devuelve [oid => valor]. */
    public static function getMulti(string $host, int $port, string $community, array $oids, int $version = 2, int $timeout = self::TIMEOUT): array
    {
        $reqId = random_int(1, 65535);
        $pduBody = self::berInt($reqId) . "\x02\x01\x00" . "\x02\x01\x00" . self::berVarbindList($oids, true);
        $pdu = "\xA0" . self::berLength(strlen($pduBody)) . $pduBody; // GetRequest
        $msg = self::berInt($version === 1 ? 0 : 1) . self::berOctet($community) . $pdu;
        $msg = "\x30" . self::berLength(strlen($msg)) . $msg;

        $resp = self::udpSend($host, $port, $msg, $timeout);
        if ($resp === null) return [];

        [$type, $children] = self::berDecode($resp, 0);
        if ($type !== 0x30 || !is_array($children) || count($children) < 3) return [];
        $pdu = $children[2];
        if (!is_array($pdu) || count($pdu) < 4) return [];
        $errorStatus = $pdu[1][1] ?? 0;
        if ($errorStatus !== 0) return [];
        $varbindList = $pdu[3][1] ?? [];
        if (!is_array($varbindList)) return [];

        $out = [];
        foreach ($varbindList as $vb) {
            if (!is_array($vb) || count($vb) < 2) continue;
            $children = is_array($vb[1]) ? $vb[1] : [];
            $o = (string) ($children[0][1] ?? '');
            $valTlv = $children[1] ?? [0, ''];
            $val = self::formatValue($valTlv);
            if ($o !== '') $out[$o] = $val;
        }
        return $out;
    }

    /** SNMP WALK (GetNext) a partir de un OID base. Devuelve [oid => valor]. */
    public static function walk(string $host, int $port, string $community, string $baseOid, int $version = 2, int $timeout = self::TIMEOUT, int $max = 50): array
    {
        $out = [];
        $current = $baseOid;
        for ($i = 0; $i < $max; $i++) {
            $reqId = random_int(1, 65535);
            $varbind = "\x30" . self::berLength(strlen(self::berOid($current)) + 2) . self::berOid($current) . "\x05\x00";
            $varbindList = "\x30" . self::berLength(strlen($varbind)) . $varbind;
            $pduBody = self::berInt($reqId) . "\x02\x01\x00" . "\x02\x01\x00" . $varbindList;
            $pdu = "\xA1" . self::berLength(strlen($pduBody)) . $pduBody; // GetNextRequest
            $msg = self::berInt($version === 1 ? 0 : 1) . self::berOctet($community) . $pdu;
            $msg = "\x30" . self::berLength(strlen($msg)) . $msg;

            $resp = self::udpSend($host, $port, $msg, $timeout);
            if ($resp === null) break;
            [$type, $children] = self::berDecode($resp, 0);
            if ($type !== 0x30 || !is_array($children) || count($children) < 3) break;
            $pdu = $children[2];
            if (!is_array($pdu) || count($pdu) < 4) break;
            if (($pdu[1][1] ?? 0) !== 0) break;
            $varbindList = $pdu[3][1] ?? [];
            if (!is_array($varbindList) || empty($varbindList)) break;
            $vb = $varbindList[0];
            if (!is_array($vb) || count($vb) < 2) break;
            $children = is_array($vb[1]) ? $vb[1] : [];
            $oid = (string) ($children[0][1] ?? '');
            if ($oid === '' || strpos($oid, $baseOid) !== 0) break;
            $out[$oid] = self::formatValue($children[1] ?? [0, '']);
            $current = $oid;
        }
        return $out;
    }

    /** Envía por UDP y devuelve la respuesta cruda o null. */
    private static function udpSend(string $host, int $port, string $data, int $timeout): ?string
    {
        $fp = @fsockopen("udp://{$host}", $port, $errno, $errstr, $timeout);
        if (!$fp) return null;
        stream_set_timeout($fp, $timeout);
        if (fwrite($fp, $data) === false) { fclose($fp); return null; }
        $resp = '';
        $deadline = microtime(true) + $timeout;
        while (microtime(true) < $deadline) {
            $chunk = fread($fp, 65535);
            if ($chunk === false) break;
            $resp .= $chunk;
            $meta = stream_get_meta_data($fp);
            if ($meta['timed_out']) break;
            if ($chunk === '') break;
        }
        fclose($fp);
        return $resp === '' ? null : $resp;
    }

    /** Formatea el valor de un varbind. */
    private static function formatValue(array $vb): string
    {
        $type = $vb[0] ?? 0;
        $val = $vb[1] ?? '';
        if ($type === 0x02) return (string) $val;          // INTEGER
        if ($type === 0x04) return (string) $val;           // OCTET STRING
        if ($type === 0x06) return (string) $val;           // OID
        if ($type === 0x40) return (string) $val;           // IpAddress
        if ($type === 0x41) return (string) $val;           // Counter32
        if ($type === 0x42) return (string) $val;           // Gauge32
        if ($type === 0x43) return (string) $val;           // TimeTicks
        if (in_array($type, [0x80, 0x81, 0x82], true)) return (string) $val; // context
        return (string) $val;
    }

    /* ---------- BER helpers ---------- */

    public static function berLength(int $len): string
    {
        if ($len < 0x80) return chr($len);
        $bytes = [];
        $tmp = $len;
        while ($tmp > 0) { array_unshift($bytes, $tmp & 0xFF); $tmp >>= 8; }
        return chr(0x80 | count($bytes)) . implode('', array_map('chr', $bytes));
    }

    public static function berInt(int $v): string
    {
        $bytes = [];
        if ($v === 0) {
            $bytes = [0];
        } else {
            $tmp = $v;
            while ($tmp > 0) { array_unshift($bytes, $tmp & 0xFF); $tmp >>= 8; }
            if ($bytes[0] & 0x80) array_unshift($bytes, 0);
        }
        return "\x02" . self::berLength(count($bytes)) . implode('', array_map('chr', $bytes));
    }

    public static function berOctet(string $s): string
    {
        return "\x04" . self::berLength(strlen($s)) . $s;
    }

    public static function berOid(string $oid): string
    {
        $parts = explode('.', ltrim($oid, '.'));
        $parts = array_values(array_filter($parts, static fn ($p) => $p !== '', ARRAY_FILTER_USE_KEY));
        $bytes = [];
        if (count($parts) >= 2) {
            $first = (int) $parts[0] * 40 + (int) $parts[1];
            $bytes = array_merge($bytes, self::encodeSubid($first));
            for ($i = 2; $i < count($parts); $i++) {
                $bytes = array_merge($bytes, self::encodeSubid((int) $parts[$i]));
            }
        } elseif (count($parts) === 1) {
            $bytes = self::encodeSubid((int) $parts[0]);
        }
        return "\x06" . self::berLength(count($bytes)) . implode('', array_map('chr', $bytes));
    }

    private static function encodeSubid(int $v): array
    {
        if ($v < 128) return [$v];
        $bytes = [];
        $bytes[] = $v & 0x7F;
        $v >>= 7;
        while ($v > 0) {
            $bytes[] = ($v & 0x7F) | 0x80;
            $v >>= 7;
        }
        return array_reverse($bytes);
    }

    public static function berVarbindList(array $oids, bool $isNull = true): string
    {
        $body = '';
        foreach ($oids as $oid) {
            $oidEnc = self::berOid($oid);
            $vb = "\x30" . self::berLength(strlen($oidEnc) + 2) . $oidEnc . ($isNull ? "\x05\x00" : '');
            $body .= $vb;
        }
        return "\x30" . self::berLength(strlen($body)) . $body;
    }

    /** Decodifica un TLV en $data desde $off. Devuelve [type, value, consumed]. */
    public static function berDecode(string $data, int $off = 0): array
    {
        $len = strlen($data);
        if ($off >= $len) return [0, null, 0];
        $type = ord($data[$off]);
        $lenByte = ord($data[$off + 1] ?? "\x00");
        $pos = $off + 2;
        if ($lenByte & 0x80) {
            $numBytes = $lenByte & 0x7F;
            $l = 0;
            for ($i = 0; $i < $numBytes && $pos < $len; $i++) {
                $l = ($l << 8) | ord($data[$pos++]);
            }
            $length = $l;
        } else {
            $length = $lenByte;
        }
        $value = substr($data, $pos, $length);
        $consumed = $pos + $length - $off;

        if ($type === 0x02) { // INTEGER
            $int = 0;
            for ($i = 0; $i < strlen($value); $i++) {
                $int = ($int << 8) | ord($value[$i]);
            }
            // negative
            if (strlen($value) > 0 && (ord($value[0]) & 0x80)) {
                $int -= (1 << (8 * strlen($value)));
            }
            return [$type, $int, $consumed];
        }
        if ($type === 0x04) return [$type, $value, $consumed]; // OCTET STRING
        if ($type === 0x05) return [$type, null, $consumed];   // NULL
        if ($type === 0x06) return [$type, self::decodeOid($value), $consumed]; // OID
        if ($type === 0x40) return [$type, self::decodeIp($value), $consumed];  // IpAddress
        if (in_array($type, [0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47], true)) {
            $int = 0;
            for ($i = 0; $i < strlen($value); $i++) { $int = ($int << 8) | ord($value[$i]); }
            return [$type, $int, $consumed];
        }
        if ($type === 0x30 || ($type & 0xE0) === 0xA0) {
            $children = [];
            $p = 0;
            $vl = strlen($value);
            while ($p < $vl) {
                [$t, $v, $c] = self::berDecode($value, $p);
                $children[] = [$t, $v];
                $p += $c;
                if ($c === 0) break;
            }
            return [$type, $children, $consumed];
        }
        return [$type, $value, $consumed];
    }

    private static function decodeOid(string $value): string
    {
        $bytes = array_values(unpack('C*', $value));
        if (empty($bytes)) return '';
        $first = $bytes[0];
        $oid = (int) floor($first / 40) . '.' . ($first % 40);
        $i = 1;
        $n = count($bytes);
        while ($i < $n) {
            $v = 0;
            while ($i < $n && ($bytes[$i] & 0x80)) {
                $v = ($v << 7) | ($bytes[$i] & 0x7F);
                $i++;
            }
            if ($i < $n) {
                $v = ($v << 7) | ($bytes[$i] & 0x7F);
                $i++;
            }
            $oid .= '.' . $v;
        }
        return $oid;
    }

    private static function decodeIp(string $value): string
    {
        if (strlen($value) !== 4) return $value;
        return ord($value[0]) . '.' . ord($value[1]) . '.' . ord($value[2]) . '.' . ord($value[3]);
    }
}