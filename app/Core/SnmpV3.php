<?php
declare(strict_types=1);

namespace App\Core;

/**
 * Cliente SNMPv3 (USM) puro en PHP: GET y WALK con autenticación (MD5/SHA)
 * y privacidad (DES/AES-128). Implementa descubrimiento de engine ID.
 *
 * Referencias: RFC 3412 (MPD), RFC 3414 (USM), RFC 3826 (AES).
 */
final class SnmpV3
{
    public const TIMEOUT = 5;

    /** Descubre el engine ID/boots/time del agente. */
    public static function discover(string $host, int $port, int $timeout = self::TIMEOUT): ?array
    {
        $msgId = random_int(1, 2147483647);
        $reqId = random_int(1, 2147483647);
        $msgGlobalData = Snmp::berInt($msgId) . Snmp::berInt(65507)
            . "\x04\x01\x00" . Snmp::berInt(3);
        $msgSecParams = "\x04\x00";
        $varbind = "\x30" . Snmp::berLength(strlen(Snmp::berOid('1.3.6.1.2.1.1.1.0')) + 2)
            . Snmp::berOid('1.3.6.1.2.1.1.1.0') . "\x05\x00";
        $varbindList = "\x30" . Snmp::berLength(strlen($varbind)) . $varbind;
        $pduBody = Snmp::berInt($reqId) . "\x02\x01\x00" . "\x02\x01\x00" . $varbindList;
        $pdu = "\xA0" . Snmp::berLength(strlen($pduBody)) . $pduBody;
        $scopedPdu = "\x30" . Snmp::berLength(4 + strlen($pdu)) . "\x04\x00\x04\x00" . $pdu;
        $msg = Snmp::berInt(3) . "\x30" . Snmp::berLength(strlen($msgGlobalData)) . $msgGlobalData
            . $msgSecParams . $scopedPdu;
        $msg = "\x30" . Snmp::berLength(strlen($msg)) . $msg;

        $resp = Snmp::udpSend($host, $port, $msg, $timeout);
        if ($resp === null) return null;

        [$type, $children] = Snmp::berDecode($resp, 0);
        if ($type !== 0x30 || !is_array($children) || count($children) < 4) return null;
        $secOctet = $children[2][1] ?? null;
        if (!is_string($secOctet)) return null;
        [$t, $secChildren] = Snmp::berDecode($secOctet, 0);
        if ($t !== 0x30 || !is_array($secChildren) || count($secChildren) < 3) return null;
        return [
            'engine_id' => (string) ($secChildren[0][1] ?? ''),
            'boots'     => (int) ($secChildren[1][1] ?? 0),
            'time'      => (int) ($secChildren[2][1] ?? 0),
        ];
    }

    /** SNMPv3 GET de varios OIDs. Devuelve [oid => valor]. */
    public static function getMulti(string $host, int $port, array $auth, array $oids, int $timeout = self::TIMEOUT): array
    {
        $engine = self::ensureEngine($host, $port, $auth, $timeout);
        if ($engine === null) return [];

        $result = self::doRequest($host, $port, $auth, $engine, $oids, 0xA0, $timeout);
        if ($result === null) return [];
        return $result;
    }

    /** SNMPv3 GET de un OID. */
    public static function get(string $host, int $port, array $auth, string $oid, int $timeout = self::TIMEOUT): ?string
    {
        $vals = self::getMulti($host, $port, $auth, [$oid], $timeout);
        return $vals[$oid] ?? null;
    }

    /** SNMPv3 WALK. */
    public static function walk(string $host, int $port, array $auth, string $baseOid, int $timeout = self::TIMEOUT, int $max = 50): array
    {
        $out = [];
        $engine = self::ensureEngine($host, $port, $auth, $timeout);
        if ($engine === null) return $out;
        $current = $baseOid;
        for ($i = 0; $i < $max; $i++) {
            $result = self::doRequest($host, $port, $auth, $engine, [$current], 0xA1, $timeout);
            if ($result === null || empty($result)) break;
            $oid = array_key_first($result);
            $val = $result[$oid];
            if ($oid === '' || strpos($oid, $baseOid) !== 0) break;
            $out[$oid] = $val;
            $current = $oid;
            // update engine time from... (not needed, time drift handled)
        }
        return $out;
    }

    /** Ejecuta una request y devuelve [oid => value] o null. */
    private static function doRequest(string $host, int $port, array $auth, array $engine, array $oids, int $pduType, int $timeout): ?array
    {
        $authProto = strtolower((string) ($auth['auth_proto'] ?? 'md5'));
        $privProto = strtolower((string) ($auth['priv_proto'] ?? 'none'));
        $user = (string) ($auth['user'] ?? '');
        $authPass = (string) ($auth['auth_pass'] ?? '');
        $privPass = (string) ($auth['priv_pass'] ?? $authPass);
        $context = (string) ($auth['context'] ?? '');

        $authAlgo = ($authProto === 'sha' || $authProto === 'sha1') ? 'sha1' : 'md5';
        $authKey = self::localizeKey($authPass, $engine['engine_id'], $authAlgo);
        $privKey = ($privProto !== 'none' && $privPass !== '')
            ? self::localizeKey($privPass, $engine['engine_id'], $authAlgo) : '';

        $boots = $engine['boots'];
        $time = $engine['time'];
        $engineId = $engine['engine_id'];

        $varbindList = Snmp::berVarbindList($oids, true);
        $reqId = random_int(1, 2147483647);
        $pduBody = Snmp::berInt($reqId) . "\x02\x01\x00" . "\x02\x01\x00" . $varbindList;
        $pdu = chr($pduType) . Snmp::berLength(strlen($pduBody)) . $pduBody;

        $contextEngineIdEnc = "\x04" . Snmp::berLength(strlen($engineId)) . $engineId;
        $contextNameEnc = "\x04" . Snmp::berLength(strlen($context)) . $context;
        $scopedPdu = "\x30" . Snmp::berLength(strlen($contextEngineIdEnc . $contextNameEnc . $pdu))
            . $contextEngineIdEnc . $contextNameEnc . $pdu;

        $msgFlags = 0x00;
        $privParams = '';
        $msgData = $scopedPdu; // plaintext default

        if ($privProto !== 'none' && $privKey !== '') {
            $msgFlags |= 0x01;
            if ($privProto === 'aes' || $privProto === 'aes128' || $privProto === 'aes-128') {
                $salt = random_bytes(8);
                $privParams = $salt;
                $iv = pack('N', $boots) . pack('N', $time) . $salt;
                $encrypted = openssl_encrypt($scopedPdu, 'aes-128-cfb', substr($privKey, 0, 16), OPENSSL_RAW_DATA, $iv);
                if ($encrypted === false) return null;
                $msgData = "\x04" . Snmp::berLength(strlen($encrypted)) . $encrypted;
            } else {
                // DES-CBC
                $salt = random_bytes(8);
                $privParams = $salt;
                $iv = substr($privKey, 8, 8);
                $bt = pack('N', $boots) . pack('N', $time);
                for ($i = 0; $i < 8; $i++) { $iv[$i] = $iv[$i] ^ $bt[$i]; }
                $padLen = 8 - (strlen($scopedPdu) % 8);
                if ($padLen === 0) $padLen = 8;
                $padded = $scopedPdu . str_repeat(chr($padLen), $padLen);
                $encrypted = openssl_encrypt($padded, 'des-cbc', substr($privKey, 0, 8), OPENSSL_RAW_DATA | OPENSSL_NO_PADDING, $iv);
                if ($encrypted === false) return null;
                $msgData = "\x04" . Snmp::berLength(strlen($encrypted)) . $encrypted;
            }
        }

        if ($authPass !== '' || $privProto !== 'none') {
            $msgFlags |= 0x02; // auth
        }

        $authParams = str_repeat("\x00", 12);
        $userNameEnc = "\x04" . Snmp::berLength(strlen($user)) . $user;
        $authParamsEnc = "\x04" . Snmp::berLength(12) . $authParams;
        $privParamsEnc = "\x04" . Snmp::berLength(strlen($privParams)) . $privParams;
        $engineIdEnc = "\x04" . Snmp::berLength(strlen($engineId)) . $engineId;
        $bootsEnc = Snmp::berInt($boots);
        $timeEnc = Snmp::berInt($time);

        $msgGlobalData = Snmp::berInt(random_int(1, 2147483647)) . Snmp::berInt(65507)
            . "\x04\x01" . chr($msgFlags) . Snmp::berInt(3);

        $secBody = $engineIdEnc . $bootsEnc . $timeEnc . $userNameEnc . $authParamsEnc . $privParamsEnc;
        $secParams = "\x30" . Snmp::berLength(strlen($secBody)) . $secBody;
        $secParamsOctet = "\x04" . Snmp::berLength(strlen($secParams)) . $secParams;

        $msg = Snmp::berInt(3)
            . "\x30" . Snmp::berLength(strlen($msgGlobalData)) . $msgGlobalData
            . $secParamsOctet
            . $msgData;
        $msg = "\x30" . Snmp::berLength(strlen($msg)) . $msg;

        // Authentication
        if ($authPass !== '' || $privProto !== 'none') {
            $hmac = hash_hmac($authAlgo === 'sha1' ? 'sha1' : 'md5', $msg, $authKey, true);
            $authParams = substr($hmac, 0, 12);
            $authParamsEnc = "\x04" . Snmp::berLength(12) . $authParams;
            $secBody = $engineIdEnc . $bootsEnc . $timeEnc . $userNameEnc . $authParamsEnc . $privParamsEnc;
            $secParams = "\x30" . Snmp::berLength(strlen($secBody)) . $secBody;
            $secParamsOctet = "\x04" . Snmp::berLength(strlen($secParams)) . $secParams;
            $msg = Snmp::berInt(3)
                . "\x30" . Snmp::berLength(strlen($msgGlobalData)) . $msgGlobalData
                . $secParamsOctet
                . $msgData;
            $msg = "\x30" . Snmp::berLength(strlen($msg)) . $msg;
        }

        $resp = Snmp::udpSend($host, $port, $msg, $timeout);
        if ($resp === null) return null;

        [$type, $children] = Snmp::berDecode($resp, 0);
        if ($type !== 0x30 || !is_array($children) || count($children) < 4) return null;

        // Parse security params (engine info)
        $respSecOctet = $children[2][1] ?? null;
        if (!is_string($respSecOctet)) return null;
        [$t, $respSecChildren] = Snmp::berDecode($respSecOctet, 0);
        if ($t !== 0x30 || !is_array($respSecChildren)) return null;

        $respMsgData = $children[3];
        // Determine if encrypted: if msgData is OCTET STRING (0x04)
        $isEncrypted = (is_array($respMsgData) && isset($respMsgData[0]) && $respMsgData[0] === 0x04);

        if ($isEncrypted) {
            $encrypted = $respMsgData[1];
            if ($privProto !== 'none' && $privKey !== '') {
                if ($privProto === 'aes' || $privProto === 'aes128' || $privProto === 'aes-128') {
                    $respPrivParams = $respSecChildren[5][1] ?? '';
                    $iv = pack('N', $boots) . pack('N', $time) . $respPrivParams;
                    $decrypted = openssl_decrypt($encrypted, 'aes-128-cfb', substr($privKey, 0, 16), OPENSSL_RAW_DATA, $iv);
                } else {
                    $respPrivParams = $respSecChildren[5][1] ?? '';
                    $iv = substr($privKey, 8, 8);
                    $bt = pack('N', $boots) . pack('N', $time);
                    for ($i = 0; $i < 8; $i++) { $iv[$i] = $iv[$i] ^ $bt[$i]; }
                    $decrypted = openssl_decrypt($encrypted, 'des-cbc', substr($privKey, 0, 8), OPENSSL_RAW_DATA | OPENSSL_NO_PADDING, $iv);
                    if ($decrypted !== false && strlen($decrypted) > 0) {
                        $pad = ord($decrypted[strlen($decrypted) - 1]);
                        if ($pad > 0 && $pad <= 8) $decrypted = substr($decrypted, 0, -$pad);
                    }
                }
                if ($decrypted === false || $decrypted === '') return null;
                $scopedPduRaw = $decrypted;
            } else {
                return null;
            }
        } else {
            // plaintext: msgData is the scopedPDU SEQUENCE directly
            // children[3] from berDecode is [type, value] where value is the raw bytes of the SEQUENCE
            if (is_array($respMsgData) && isset($respMsgData[1]) && is_string($respMsgData[1])) {
                // It's a TLV wrapper; the value should be the scopedPDU bytes
                $scopedPduRaw = $respMsgData[1];
            } elseif (is_string($respMsgData)) {
                $scopedPduRaw = $respMsgData;
            } else {
                return null;
            }
        }

        if (!is_string($scopedPduRaw) || $scopedPduRaw === '') return null;
        [$st, $sc] = Snmp::berDecode($scopedPduRaw, 0);
        if ($st !== 0x30 || !is_array($sc) || count($sc) < 3) return null;
        $pdu = $sc[2];
        if (!is_array($pdu) || count($pdu) < 4) return null;
        if (($pdu[1][1] ?? 0) !== 0) return null;
        $varbindList = $pdu[3][1] ?? [];
        if (!is_array($varbindList) || empty($varbindList)) return null;

        $out = [];
        foreach ($varbindList as $vb) {
            if (!is_array($vb) || count($vb) < 2) continue;
            $children = is_array($vb[1]) ? $vb[1] : [];
            $oid = (string) ($children[0][1] ?? '');
            $val = (string) ($children[1][1] ?? '');
            // format value based on type
            $type = $children[1][0] ?? 0;
            if (in_array($type, [0x41, 0x42, 0x43], true)) {
                $val = (string) (int) $val;
            }
            if ($oid !== '') $out[$oid] = $val;
        }
        return $out;
    }

    private static array $engineCache = [];

    private static function ensureEngine(string $host, int $port, array $auth, int $timeout): ?array
    {
        $key = $host . ':' . $port;
        if (!empty($auth['engine_id'])) {
            return [
                'engine_id' => $auth['engine_id'],
                'boots' => (int) ($auth['engine_boots'] ?? 0),
                'time' => (int) ($auth['engine_time'] ?? 0),
            ];
        }
        if (isset(self::$engineCache[$key])) {
            return self::$engineCache[$key];
        }
        $discovered = self::discover($host, $port, $timeout);
        if ($discovered !== null) {
            self::$engineCache[$key] = $discovered;
        }
        return $discovered;
    }

    private static function localizeKey(string $password, string $engineId, string $hashAlgo): string
    {
        if (strlen($password) > 64) {
            $password = hash($hashAlgo, $password, true);
        }
        $password = str_pad($password, 64, "\x00");
        $K = hash($hashAlgo, $password, true);
        return hash($hashAlgo, $K . $engineId . $K, true);
    }
}
