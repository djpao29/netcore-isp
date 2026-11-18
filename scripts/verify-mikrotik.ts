// Verificación local del cliente RouterOS contra un servidor mock que habla
// el protocolo binario real (palabras con longitud codificada, !re/!done/!trap).
// No forma parte de la app: se usa solo para probar mikrotik.ts sin un equipo.
import net from 'net';
import crypto from 'crypto';
import { testRouterConnection, runRouterTool, setPppoeEnabled } from '../mikrotik';

const CHALLENGE = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
const EXPECTED_RESPONSE =
  '00' + crypto.createHash('md5').update(Buffer.concat([CHALLENGE, Buffer.from('secret')])).digest('hex');

function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  const b = Buffer.allocUnsafe(2);
  b[0] = (len >> 8) | 0x80;
  b[1] = len & 0xff;
  return b;
}

function encodeSentence(words: string[]): Buffer {
  const parts: Buffer[] = [];
  for (const w of words) {
    const buf = Buffer.from(w, 'utf8');
    parts.push(encodeLength(buf.length), buf);
  }
  parts.push(encodeLength(0));
  return Buffer.concat(parts);
}

function decodeLength(buf: Buffer, offset: number): { len: number; bytes: number } | null {
  const b0 = buf[offset];
  if (b0 === undefined) return null;
  if ((b0 & 0x80) === 0) return { len: b0, bytes: 1 };
  if ((b0 & 0xc0) === 0x80 && offset + 1 < buf.length)
    return { len: ((b0 & 0x3f) << 8) | buf[offset + 1], bytes: 2 };
  if ((b0 & 0xe0) === 0xc0 && offset + 2 < buf.length)
    return { len: ((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytes: 3 };
  if ((b0 & 0xf0) === 0xe0 && offset + 3 < buf.length)
    return {
      len: ((b0 & 0x0f) << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3],
      bytes: 4,
    };
  if (b0 === 0xf0 && offset + 4 < buf.length) return { len: buf.readUInt32BE(offset + 1), bytes: 5 };
  return null;
}

function parseSentences(buffer: Buffer): { sentences: string[][]; rest: Buffer } {
  const sentences: string[][] = [];
  let offset = 0;
  while (true) {
    const words: string[] = [];
    let start = offset;
    let complete = true;
    while (true) {
      const d = decodeLength(buffer, offset);
      if (!d) {
        complete = false;
        break;
      }
      offset += d.bytes;
      if (d.len === 0) break;
      if (offset + d.len > buffer.length) {
        complete = false;
        break;
      }
      words.push(buffer.slice(offset, offset + d.len).toString('utf8'));
      offset += d.len;
    }
    if (!complete) {
      offset = start;
      break;
    }
    sentences.push(words);
  }
  return { sentences, rest: buffer.slice(offset) };
}

function handler(words: string[], mode: 'plain' | 'challenge'): { reply: string[][]; close?: boolean } {
  const cmd = words[0];
  if (cmd === '/login') {
    if (mode === 'challenge') {
      const response = words.find((w) => w.startsWith('=response='));
      if (!response) return { reply: [['!done', `=ret=${CHALLENGE.toString('hex')}`]] };
      if (response !== `=response=${EXPECTED_RESPONSE}`)
        return { reply: [['!trap', '=message=invalid credentials'], ['!done']] };
      return { reply: [['!done']] };
    }
    return { reply: [['!done']] };
  }
  if (cmd === '/system/identity/print') return { reply: [['!re', '=name=MockRouterOS'], ['!done']] };
  if (cmd === '/system/resource/print')
    return {
      reply: [
        ['!re', '=version=7.15.1', '=uptime=1d2h3m', '=board-name=RB750Gr3', '=cpu-load=3', '=free-memory=104857600'],
        ['!done'],
      ],
    };
  if (cmd === '/ppp/active/print') {
    // Responde con 1 fila si viene filtro ?name=, o 3 si es listado completo.
    const filtered = words.some((w) => w.startsWith('?name='));
    const rows = filtered
      ? [['!re', '=.id=*A1', '=name=cliente_101', '=address=10.10.0.2']]
      : [
          ['!re', '=.id=*A1', '=name=cliente_101', '=address=10.10.0.2'],
          ['!re', '=.id=*A2', '=name=cliente_102', '=address=10.10.0.3'],
          ['!re', '=.id=*A3', '=name=cliente_103', '=address=10.10.0.4'],
        ];
    return { reply: [...rows, ['!done']] };
  }
  if (cmd === '/ppp/secret/print') return { reply: [['!re', '=.id=*B7', '=name=cliente_101'], ['!done']] };
  if (cmd === '/ppp/secret/set') return { reply: [['!done']] };
  if (cmd === '/ppp/active/remove') return { reply: [['!done']] };
  if (cmd === '/ip/firewall/address-list/print') return { reply: [['!trap', '=message=no such command'], ['!done']] };
  if (cmd === '/system/reboot') return { reply: [['!done']], close: true };
  return { reply: [['!done']] };
}

async function main() {
  const makeServer = (mode: 'plain' | 'challenge') =>
    net.createServer((socket) => {
      let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
      socket.on('data', (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const { sentences, rest } = parseSentences(buffer);
        buffer = rest;
        for (const words of sentences) {
          const { reply, close } = handler(words, mode);
          for (const sentence of reply) socket.write(encodeSentence(sentence));
          if (close) socket.end();
        }
      });
    });

  const server = makeServer('plain');
  const challengeServer = makeServer('challenge');
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  await new Promise<void>((resolve) => challengeServer.listen(0, '127.0.0.1', resolve));
  const addr = server.address() as net.AddressInfo;
  const challengeAddr = challengeServer.address() as net.AddressInfo;
  const creds = { host: '127.0.0.1', port: addr.port, user: 'admin', password: 'secret' };

  const results: string[] = [];
  const assert = (label: string, cond: boolean, extra = '') => {
    results.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? ` :: ${extra}` : ''}`);
  };

  const test = await testRouterConnection(creds);
  assert('testRouterConnection ok', test.ok === true, test.message);
  assert('identity leída', test.identity === 'MockRouterOS', String(test.identity));
  assert('version leída', test.version === '7.15.1', String(test.version));
  assert('board leída', test.board === 'RB750Gr3', String(test.board));

  const ppp = await runRouterTool(creds, 'ppp-active', 'mock');
  assert('runRouterTool ppp-active 3 filas', ppp.rows === 3, `rows=${ppp.rows}`);

  const identified = await runRouterTool(creds, 'identity', 'mock');
  assert('runRouterTool identity', identified.text.includes('MockRouterOS'));

  let trapOk = false;
  try {
    await runRouterTool(creds, 'address-list', 'mock');
  } catch (err: any) {
    trapOk = /no such command/.test(String(err?.message));
  }
  assert('!trap propagado como error', trapOk);

  const set = await setPppoeEnabled(creds, 'cliente_101', false);
  assert('setPppoeEnabled ok', set.ok === true, set.message);

  const notFound = await setPppoeEnabled(creds, 'desconocido', false);
  // El mock siempre devuelve el secreto; probamos la rama de error contra un server sin secreto sería otro caso.

  const bad = await testRouterConnection({ ...creds, port: 1, timeoutMs: 800 });
  assert('fallo de conexión reportado', bad.ok === false, bad.message);

  const legacy = await testRouterConnection({
    host: '127.0.0.1',
    port: challengeAddr.port,
    user: 'admin',
    password: 'secret',
  });
  assert('login con reto MD5 (RouterOS antiguo)', legacy.ok === true, legacy.message);

  const legacyBad = await testRouterConnection({
    host: '127.0.0.1',
    port: challengeAddr.port,
    user: 'admin',
    password: 'clave-incorrecta',
  });
  assert('credenciales inválidas rechazadas', legacyBad.ok === false, legacyBad.message);

  server.close();
  challengeServer.close();
  console.log(results.join('\n'));
  const failed = results.filter((r) => r.startsWith('FAIL'));
  console.log(`\n${results.length - failed.length}/${results.length} pruebas OK`);
  process.exit(failed.length ? 1 : 0);
  void notFound;
}

main().catch((e) => {
  console.error('ERROR', e);
  process.exit(1);
});
