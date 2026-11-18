// Servidor mock persistente que habla el protocolo binario de RouterOS.
// Se usa para probar el cliente PHP (scripts/verify-mikrotik.php) y el de Node.
// Uso: npx tsx scripts/mock-routeros-server.ts [puerto]
import net from 'net';

const PORT = Number(process.argv[2] || 18728);

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
  if ((b0 & 0xc0) === 0x80 && offset + 1 < buf.length) return { len: ((b0 & 0x3f) << 8) | buf[offset + 1], bytes: 2 };
  if ((b0 & 0xe0) === 0xc0 && offset + 2 < buf.length) return { len: ((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytes: 3 };
  if ((b0 & 0xf0) === 0xe0 && offset + 3 < buf.length) return { len: ((b0 & 0x0f) << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3], bytes: 4 };
  if (b0 === 0xf0 && offset + 4 < buf.length) return { len: buf.readUInt32BE(offset + 1), bytes: 5 };
  return null;
}

function parse(buffer: Buffer): { sentences: string[][]; rest: Buffer } {
  const sentences: string[][] = [];
  let offset = 0;
  while (true) {
    const words: string[] = [];
    const start = offset;
    let complete = true;
    while (true) {
      const d = decodeLength(buffer, offset);
      if (!d) { complete = false; break; }
      offset += d.bytes;
      if (d.len === 0) break;
      if (offset + d.len > buffer.length) { complete = false; break; }
      words.push(buffer.slice(offset, offset + d.len).toString('utf8'));
      offset += d.len;
    }
    if (!complete) { offset = start; break; }
    sentences.push(words);
  }
  return { sentences, rest: buffer.slice(offset) };
}

function handler(words: string[]): string[][] {
  const cmd = words[0];
  if (cmd === '/login') return [['!done']];
  if (cmd === '/system/identity/print') return [['!re', '=name=MockRouterOS'], ['!done']];
  if (cmd === '/system/resource/print')
    return [['!re', '=version=7.15.1', '=uptime=1d2h3m', '=board-name=RB750Gr3', '=cpu-load=3', '=free-memory=104857600'], ['!done']];
  if (cmd === '/ppp/active/print') {
    const filtered = words.some((w) => w.startsWith('?name='));
    if (filtered) return [['!re', '=.id=*A1', '=name=cliente_101'], ['!done']];
    return [
      ['!re', '=.id=*A1', '=name=cliente_101'],
      ['!re', '=.id=*A2', '=name=cliente_102'],
      ['!re', '=.id=*A3', '=name=cliente_103'],
      ['!done'],
    ];
  }
  if (cmd === '/ppp/secret/print') return [['!re', '=.id=*B7', '=name=cliente_101'], ['!done']];
  if (cmd === '/ppp/secret/set') return [['!done']];
  if (cmd === '/ppp/active/remove') return [['!done']];
  if (cmd === '/ip/firewall/address-list/print') return [['!trap', '=message=no such command'], ['!done']];
  return [['!done']];
}

const server = net.createServer((socket) => {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  socket.on('error', () => {
    // El cliente cerró abruptamente (p. ej. tras un !trap): ignorar en el mock.
  });
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    const { sentences, rest } = parse(buffer);
    buffer = rest;
    for (const words of sentences) {
      for (const sentence of handler(words)) socket.write(encodeSentence(sentence));
    }
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock RouterOS escuchando en 127.0.0.1:${PORT}`);
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`mock RouterOS escuchando en 127.0.0.1:${PORT}`);
});
