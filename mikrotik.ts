// ============================================================================
//  Cliente REAL de la API de MikroTik RouterOS
//  Implementa el protocolo binario de RouterOS (puerto 8728 y 8729/TLS):
//  palabras con longitud codificada, sentencias terminadas en longitud 0,
//  login (incluye reto MD5 para RouterOS < 6.43) y lectura de respuestas
//  !re / !done / !trap / !fatal.
//
//  No es simulado: abre un socket TCP/TLS real contra el equipo. Si el equipo
//  no es alcanzable o las credenciales son incorrectas, devuelve el error real.
//  SOPORTE WireGuard: túnel cifrado para routers detrás de NAT/CGNAT,
//  exponiendo SOLO puerto UDP 51820 a Internet (nunca 8728/8729).
// ============================================================================
import net from 'net';
import tls from 'tls';
import crypto from 'crypto';
import { WireGuardMikrotikClient, WireGuardConfig, generateWireGuardKeys } from './wireguard.js';

export interface RouterCreds {
  host: string;
  port?: number;
  user: string;
  password: string;
  tls?: boolean;
  timeoutMs?: number;

  // --- WireGuard (opcional) ---
  // Si se proporciona, el cliente PRIMERO establece túnel WireGuard
  // y luego habla API por el túnel (routerTunnelIP).
  // NUNCA expone 8728/8729 a Internet.
  wireguard?: {
    /** Configuración completa del túnel (generada con generateWireGuardSetup) */
    config: WireGuardConfig;
    /** IP del router DENTRO del túnel (ej: "10.8.0.1") */
    routerTunnelIP: string;
    /** Nombre de interfaz local (default: "wg-mikrotik") */
    interfaceName?: string;
    /** Forzar wireguard-tools del sistema (default: true) */
    preferSystemWG?: boolean;
  };
}

type Sentence = string[];

// --- Codificación de longitud de palabra (protocolo RouterOS) -------------
function encodeLength(len: number): Buffer {
  if (len < 0x80) return Buffer.from([len]);
  if (len < 0x4000) {
    const b = Buffer.allocUnsafe(2);
    b[0] = (len >> 8) | 0x80;
    b[1] = len & 0xff;
    return b;
  }
  if (len < 0x200000) {
    const b = Buffer.allocUnsafe(3);
    b[0] = (len >> 16) | 0xc0;
    b[1] = (len >> 8) & 0xff;
    b[2] = len & 0xff;
    return b;
  }
  if (len < 0x10000000) {
    const b = Buffer.allocUnsafe(4);
    b[0] = (len >> 24) | 0xe0;
    b[1] = (len >> 16) & 0xff;
    b[2] = (len >> 8) & 0xff;
    b[3] = len & 0xff;
    return b;
  }
  const b = Buffer.allocUnsafe(5);
  b[0] = 0xf0;
  b.writeUInt32BE(len >>> 0, 1);
  return b;
}

function decodeLength(buf: Buffer, offset: number): { len: number; bytes: number } | null {
  const b0 = buf[offset];
  if (b0 === undefined) return null;
  if ((b0 & 0x80) === 0) return { len: b0, bytes: 1 };
  if ((b0 & 0xc0) === 0x80) {
    if (offset + 1 >= buf.length) return null;
    return { len: ((b0 & 0x3f) << 8) | buf[offset + 1], bytes: 2 };
  }
  if ((b0 & 0xe0) === 0xc0) {
    if (offset + 2 >= buf.length) return null;
    return { len: ((b0 & 0x1f) << 16) | (buf[offset + 1] << 8) | buf[offset + 2], bytes: 3 };
  }
  if ((b0 & 0xf0) === 0xe0) {
    if (offset + 3 >= buf.length) return null;
    return {
      len: ((b0 & 0x0f) << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3],
      bytes: 4,
    };
  }
  if (b0 === 0xf0) {
    if (offset + 4 >= buf.length) return null;
    return { len: buf.readUInt32BE(offset + 1), bytes: 5 };
  }
  return null;
}

// --- Cliente --------------------------------------------------------------
export class MikrotikClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private queue: Sentence[] = [];
  private waiters: Array<{ resolve: (s: Sentence) => void; reject: (e: Error) => void }> = [];
  private closedError: Error | null = null;

  private constructor(
    private creds: Required<Pick<RouterCreds, 'host' | 'port' | 'user' | 'password' | 'tls' | 'timeoutMs'>>
  ) {}

  static async connect(creds: RouterCreds): Promise<MikrotikClient> {
    const norm = {
      host: creds.host,
      port: creds.port || (creds.tls ? 8729 : 8728),
      user: creds.user || 'admin',
      password: creds.password || '',
      tls: !!creds.tls,
      timeoutMs: creds.timeoutMs || 8000,
    };
    const client = new MikrotikClient(norm);
    await client.open();
    await client.login();
    return client;
  }

  /**
   * Conecta a través de túnel WireGuard.
   * El túnel cifra todo el tráfico; el router NO expone 8728/8729 a Internet.
   * Solo puerto UDP 51820 (WireGuard) está abierto en el router.
   */
  static async connectWithWireGuard(creds: RouterCreds): Promise<WireGuardMikrotikClient> {
    if (!creds.wireguard) {
      throw new Error('Configuración WireGuard requerida en creds.wireguard');
    }

    const { config, routerTunnelIP, interfaceName, preferSystemWG } = creds.wireguard;

    const wgClient = new WireGuardMikrotikClient(creds, config, {
      interfaceName,
      preferSystemWG,
      routerTunnelIP,
    });

    await wgClient.connect();
    return wgClient;
  }

  private open(): Promise<void> {
    return new Promise((resolve, reject) => {
      const onError = (err: Error) => {
        this.closedError = err;
        this.flushWaiters(err);
        reject(err);
      };
      let socket: net.Socket | tls.TLSSocket;
      if (this.creds.tls) {
        socket = tls.connect(
          { host: this.creds.host, port: this.creds.port, rejectUnauthorized: false },
          () => {
            this.socket = socket;
            this.attach();
            resolve();
          }
        );
      } else {
        socket = net.connect({ host: this.creds.host, port: this.creds.port }, () => {
          this.socket = socket;
          this.attach();
          resolve();
        });
      }
      socket.setTimeout(this.creds.timeoutMs);
      socket.once('error', onError);
      socket.once('timeout', () => {
        socket.destroy();
        onError(new Error(`Tiempo de espera agotado al conectar a ${this.creds.host}:${this.creds.port}.`));
      });
    });
  }

  private attach() {
    if (!this.socket) return;
    this.socket.removeAllListeners('error');
    this.socket.removeAllListeners('timeout');
    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.parse();
    });
    this.socket.on('error', (err: Error) => {
      this.closedError = err;
      this.flushWaiters(err);
    });
    this.socket.on('close', () => {
      if (!this.closedError) {
        this.closedError = new Error('El router cerró la conexión.');
        this.flushWaiters(this.closedError);
      }
    });
  }

  private parse() {
    // Extrae todas las sentencias completas del buffer.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      let offset = 0;
      const words: string[] = [];
      let complete = true;
      while (true) {
        const d = decodeLength(this.buffer, offset);
        if (!d) {
          complete = false;
          break;
        }
        offset += d.bytes;
        if (d.len === 0) break; // fin de sentencia
        if (offset + d.len > this.buffer.length) {
          complete = false;
          break;
        }
        words.push(this.buffer.slice(offset, offset + d.len).toString('utf8'));
        offset += d.len;
      }
      if (!complete) return;
      this.buffer = this.buffer.slice(offset);
      this.push(words);
    }
  }

  private push(sentence: Sentence) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(sentence);
    else this.queue.push(sentence);
  }

  private flushWaiters(err: Error) {
    while (this.waiters.length) this.waiters.shift()!.reject(err);
  }

  private read(): Promise<Sentence> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise<Sentence>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error('El router no respondió a tiempo.'));
      }, this.creds.timeoutMs);
      const wrapped = (s: Sentence) => {
        clearTimeout(timer);
        resolve(s);
      };
      this.waiters.push({ resolve: wrapped, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
  }

  private write(sentence: Sentence) {
    if (!this.socket) throw new Error('Sin conexión con el router.');
    const parts: Buffer[] = [];
    for (const word of sentence) {
      const w = Buffer.from(word, 'utf8');
      parts.push(encodeLength(w.length), w);
    }
    parts.push(encodeLength(0));
    this.socket.write(Buffer.concat(parts));
  }

  private async login() {
    this.write(['/login', `=name=${this.creds.user}`, `=password=${this.creds.password}`]);
    let sentence = await this.read();

    // RouterOS antiguo: responde con reto MD5 en lugar de aceptar la contraseña.
    const ret = sentence.find((w) => w.startsWith('=ret='));
    if (ret) {
      const challenge = Buffer.from(ret.slice(5), 'hex');
      const digest = crypto
        .createHash('md5')
        .update(Buffer.concat([challenge, Buffer.from(this.creds.password)]))
        .digest('hex');
      this.write(['/login', `=name=${this.creds.user}`, `=response=00${digest}`]);
      sentence = await this.read();
    }

    if (sentence[0] === '!trap' || sentence[0] === '!fatal') {
      const msg = sentence.find((w) => w.startsWith('=message='))?.slice(9) || 'credenciales rechazadas';
      throw new Error(`Autenticación fallida en ${this.creds.host}: ${msg}`);
    }
    if (sentence[0] !== '!done') {
      throw new Error(`Respuesta de login inesperada: ${sentence.join(' ')}`);
    }
  }

  /** Ejecuta un comando y recolecta las filas !re hasta !done/!trap. */
  async talk(words: Sentence): Promise<{ rows: Sentence[]; trapped?: string; done: boolean }> {
    this.write(words);
    const rows: Sentence[] = [];
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const sentence = await this.read();
      const tag = sentence[0];
      if (tag === '!re') {
        rows.push(sentence.slice(1));
        continue;
      }
      if (tag === '!trap') {
        const msg = sentence.find((w) => w.startsWith('=message='))?.slice(9) || 'error';
        return { rows, trapped: msg, done: false };
      }
      if (tag === '!fatal') {
        const msg = sentence.find((w) => w.startsWith('=message='))?.slice(9) || 'error fatal';
        throw new Error(msg);
      }
      if (tag === '!done') return { rows, done: true };
      // Sentencias inesperadas (!empty, etc.) se ignoran.
    }
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

// --- Formateo legible de filas -------------------------------------------
function formatRows(rows: Sentence[]): string {
  if (!rows.length) return '(sin filas devueltas por el router)';
  return rows
    .map((row) =>
      row
        .filter((w) => !w.startsWith('=.id=') && !w.startsWith('=#'))
        .map((w) => {
          const clean = w.replace(/^=/, '');
          const eq = clean.indexOf('=');
          return eq === -1 ? clean : `${clean.slice(0, eq)}: ${clean.slice(eq + 1)}`;
        })
        .filter(Boolean)
        .join(' | ')
    )
    .join('\n');
}

// --- Herramientas por nombre ---------------------------------------------
function buildCommand(tool: string, routerName: string): { words: Sentence; note?: string } {
  const safe = routerName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  switch (tool) {
    case 'ping':
      return { words: ['/ping', '=address=8.8.8.8', '=count=4'], note: 'Ping desde el router hacia 8.8.8.8' };
    case 'log':
      return { words: ['/log/print'] };
    case 'ppp-active':
      return { words: ['/ppp/active/print'] };
    case 'arp':
      return { words: ['/ip/arp/print'] };
    case 'dhcp-leases':
      return { words: ['/ip/dhcp-server/lease/print'] };
    case 'ip-bindings':
      return { words: ['/ip/hotspot/ip-binding/print'] };
    case 'address-list':
      return { words: ['/ip/firewall/address-list/print'] };
    case 'pool-ipv6':
      return { words: ['/ipv6/pool/print'] };
    case 'torch':
      return { words: ['/interface/print', '=.proplist=name,type,running,rx-byte,tx-byte'], note: 'Estadísticas de interfaces' };
    case 'backup':
      return { words: ['/system/backup/save', `=name=backup-${safe}-${stamp}`], note: 'Respaldo creado en el equipo (Files)' };
    case 'reboot':
      return { words: ['/system/reboot'], note: 'El equipo se reiniciará y cerrará la conexión' };
    case 'resource':
      return { words: ['/system/resource/print'] };
    case 'identity':
      return { words: ['/system/identity/print'] };
    default:
      throw new Error(`Herramienta no reconocida: ${tool}`);
  }
}

const TOOL_LABEL: Record<string, string> = {
  ping: 'ping',
  log: 'log',
  'ppp-active': 'sesiones PPPoE activas',
  arp: 'tabla ARP',
  'dhcp-leases': 'concesiones DHCP',
  'ip-bindings': 'IP Bindings',
  'address-list': 'Address Lists',
  'pool-ipv6': 'pools IPv6',
  torch: 'interfaces / tráfico',
  backup: 'respaldo',
  reboot: 'reinicio',
  resource: 'recursos del sistema',
  identity: 'identidad del equipo',
};

export interface RouterToolResult {
  tool: string;
  command: string;
  text: string;
  rows: number;
  note?: string;
}

/** Ejecuta una herramienta real sobre un RouterOS y devuelve la salida formateada. */
export async function runRouterTool(
  creds: RouterCreds,
  tool: string,
  routerName: string
): Promise<RouterToolResult> {
  const { words, note } = buildCommand(tool, routerName);

  // Usar WireGuard si está configurado
  const useWireGuard = !!creds.wireguard;
  let client: MikrotikClient | WireGuardMikrotikClient;

  if (useWireGuard) {
    client = await MikrotikClient.connectWithWireGuard(creds);
  } else {
    client = await MikrotikClient.connect(creds);
  }

  try {
    const res = await client.talk(words);
    if (res.trapped) {
      throw new Error(`RouterOS respondió con error: ${res.trapped}`);
    }
    const body = formatRows(res.rows);
    return {
      tool,
      command: words.join(' '),
      rows: res.rows.length,
      note,
      text: `${note ? `# ${note}\n` : ''}$ ${words.join(' ')}\n\n${body}`,
    };
  } finally {
    await client.close();
  }
}

export interface RouterTestResult {
  ok: boolean;
  identity?: string;
  version?: string;
  uptime?: string;
  board?: string;
  cpu_load?: string;
  free_memory?: string;
  message: string;
}

/** Prueba de conexión real: autentica y consulta identidad + recursos. */
export async function testRouterConnection(creds: RouterCreds): Promise<RouterTestResult> {
  const useWireGuard = !!creds.wireguard;
  let client: MikrotikClient | WireGuardMikrotikClient;

  try {
    if (useWireGuard) {
      client = await MikrotikClient.connectWithWireGuard(creds);
    } else {
      client = await MikrotikClient.connect(creds);
    }
  } catch (err: any) {
    const via = useWireGuard ? 'WireGuard' : 'directo';
    return { ok: false, message: `No se pudo conectar/autenticar en ${creds.host} (${via}): ${err?.message || err}` };
  }

  try {
    const identity = await client.talk(['/system/identity/print']);
    const resource = await client.talk(['/system/resource/print']);
    const pick = (rows: Sentence[], key: string) => {
      const row = rows[0] || [];
      const w = row.find((x) => x.startsWith(`=${key}=`));
      return w ? w.slice(key.length + 2) : undefined;
    };
    const via = useWireGuard ? 'WireGuard' : 'directo';
    return {
      ok: true,
      identity: pick(identity.rows, 'name'),
      version: pick(resource.rows, 'version'),
      uptime: pick(resource.rows, 'uptime'),
      board: pick(resource.rows, 'board-name'),
      cpu_load: pick(resource.rows, 'cpu-load'),
      free_memory: pick(resource.rows, 'free-memory'),
      message: `Conexión correcta con ${creds.host} (${via}).`,
    };
  } catch (err: any) {
    return { ok: false, message: `Conectado pero la consulta falló: ${err?.message || err}` };
  } finally {
    await client.close();
  }
}

/** Habilita/deshabilita un secreto PPPoE real (para cortes y reconexiones). */
export async function setPppoeEnabled(
  creds: RouterCreds,
  username: string,
  enabled: boolean
): Promise<{ ok: boolean; message: string }> {
  const useWireGuard = !!creds.wireguard;
  let client: MikrotikClient | WireGuardMikrotikClient;

  try {
    if (useWireGuard) {
      client = await MikrotikClient.connectWithWireGuard(creds);
    } else {
      client = await MikrotikClient.connect(creds);
    }
  } catch (err: any) {
    return { ok: false, message: `No se pudo conectar: ${err?.message || err}` };
  }

  try {
    const found = await client.talk(['/ppp/secret/print', `?name=${username}`]);
    const idWord = (found.rows[0] || []).find((w) => w.startsWith('=.id='));
    if (!idWord) {
      return { ok: false, message: `No existe el secreto PPPoE "${username}" en el router.` };
    }
    const id = idWord.slice(5);
    const set = await client.talk(['/ppp/secret/set', `=.id=${id}`, `=disabled=${enabled ? 'no' : 'yes'}`]);
    if (set.trapped) return { ok: false, message: set.trapped };

    // Si se deshabilita, expulsa la sesión activa para que el corte sea efectivo.
    if (!enabled) {
      const active = await client.talk(['/ppp/active/print', `?name=${username}`]);
      const activeId = (active.rows[0] || []).find((w) => w.startsWith('=.id='));
      if (activeId) {
        await client.talk(['/ppp/active/remove', `=.id=${activeId.slice(5)}`]);
      }
    }
    return {
      ok: true,
      message: `Secreto PPPoE "${username}" ${enabled ? 'habilitado' : 'deshabilitado'} en el router.`,
    };
  } finally {
    await client.close();
  }
}
