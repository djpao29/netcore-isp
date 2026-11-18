const dgram = require('dgram');
const socket = dgram.createSocket('udp4');

const VALUES = {
  '1.3.6.1.2.1.1.1.0': 'MockOLT ZTE C320 GPON OLT',
  '1.3.6.1.2.1.1.5.0': 'OLT-Mock-01',
  '1.3.6.1.2.1.1.3.0': 1234567,
  '1.3.6.1.2.1.2.1.0': 8,
};

function encodeLength(len) {
  if (len < 0x80) return Buffer.from([len]);
  const b = Buffer.allocUnsafe(2);
  b[0] = (len >> 8) | 0x80;
  b[1] = len & 0xff;
  return b;
}
function encodeTlv(tag, value) {
  return Buffer.concat([Buffer.from([tag]), encodeLength(value.length), value]);
}
function encodeInt(v) {
  const bytes = [];
  if (v === 0) bytes.push(0);
  else { let t = v; while (t > 0) { bytes.unshift(t & 0xff); t >>= 8; } if (bytes[0] & 0x80) bytes.unshift(0); }
  return encodeTlv(0x02, Buffer.from(bytes));
}
function encodeOid(oid) {
  const parts = oid.split('.').map(Number);
  const bytes = [];
  if (parts.length >= 2) {
    bytes.push(parts[0] * 40 + parts[1]);
    for (let i = 2; i < parts.length; i++) {
      let v = parts[i];
      const tmp = [];
      tmp.push(v & 0x7f);
      v >>= 7;
      while (v > 0) { tmp.push((v & 0x7f) | 0x80); v >>= 7; }
      tmp.reverse().forEach(b => bytes.push(b));
    }
  }
  return encodeTlv(0x06, Buffer.from(bytes));
}
function encodeOctet(s) { return encodeTlv(0x04, Buffer.from(s)); }
function berDecode(buf, off) {
  const type = buf[off];
  let pos = off + 1;
  let len = buf[pos++];
  if (len & 0x80) {
    const nb = len & 0x7f;
    len = 0;
    for (let i = 0; i < nb; i++) len = (len << 8) | buf[pos++];
  }
  const value = buf.slice(pos, pos + len);
  const consumed = pos + len - off;
  if (type === 0x02) { let v = 0; for (let i = 0; i < value.length; i++) v = (v << 8) | value[i]; return { type, value: v, consumed }; }
  if (type === 0x04) return { type, value: value.toString(), consumed };
  if (type === 0x06) return { type, value: decodeOid(value), consumed };
  if (type === 0x30 || (type & 0xe0) === 0xa0) {
    const children = []; let p = 0;
    while (p < value.length) { const c = berDecode(value, p); children.push(c); p += c.consumed; }
    return { type, value: children, consumed };
  }
  return { type, value, consumed };
}
function decodeOid(buf) {
  const bytes = Array.from(buf);
  if (!bytes.length) return '';
  let oid = Math.floor(bytes[0]/40) + '.' + (bytes[0] % 40);
  let i = 1;
  while (i < bytes.length) {
    let v = 0;
    while (i < bytes.length && (bytes[i] & 0x80)) { v = (v << 7) | (bytes[i] & 0x7f); i++; }
    if (i < bytes.length) { v = (v << 7) | (bytes[i] & 0x7f); i++; }
    oid += '.' + v;
  }
  return oid;
}

socket.on('message', (msg, rinfo) => {
  try {
    const top = berDecode(msg, 0);
    const pdu = top.value[2];
    const varbindList = pdu.value[3].value;
    const reqOid = varbindList[0].value[0].value;
    const value = VALUES[reqOid];
    let valTlv;
    if (typeof value === 'number') valTlv = encodeInt(value);
    else if (typeof value === 'string' && /^\d+\.\d+\.\d+\.\d+$/.test(value)) valTlv = encodeTlv(0x40, Buffer.from(value.split('.').map(Number)));
    else valTlv = encodeOctet(String(value ?? ''));
    const respVarbind = Buffer.concat([encodeOid(reqOid), valTlv]);
    const respVbSeq = encodeTlv(0x30, respVarbind);
    const respVbList = encodeTlv(0x30, respVbSeq);
    const pduBody = Buffer.concat([encodeInt(pdu.value[0].value), encodeInt(0), encodeInt(0), respVbList]);
    const responsePdu = encodeTlv(0xa2, pduBody);
    const community = top.value[1].value;
    const version = top.value[0].value;
    const msgBody = Buffer.concat([encodeInt(version), encodeOctet(community), responsePdu]);
    const response = encodeTlv(0x30, msgBody);
    socket.send(response, rinfo.port, rinfo.address);
    console.log('SNMP GET', reqOid, '->', value);
  } catch (e) {
    console.log('err', e.message);
  }
});

socket.bind(1161, '127.0.0.1', () => {
  console.log('mock SNMP agent listening on 127.0.0.1:1161');
});