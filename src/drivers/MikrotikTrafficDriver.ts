import net from 'net';
import tls from 'tls';
import crypto from 'crypto';

export interface RouterCreds {
  host: string;
  port?: number;
  user: string;
  password: string;
  tls?: boolean;
  timeoutMs?: number;
}

type Sentence = string[];

// --- Longitud codificada (protocolo RouterOS) ---
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

// --- Cliente MikroTik ---
export class MikrotikClient {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private buffer: Buffer = Buffer.alloc(0);
  private queue: string[][] = [];
  private waiters: Array<{ resolve: (s: string[]) => void; reject: (e: Error) => void }> = [];
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
        if (d.len === 0) break;
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

  private push(sentence: string[]) {
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve(sentence);
    else this.queue.push(sentence);
  }

  private flushWaiters(err: Error) {
    while (this.waiters.length) this.waiters.shift()!.reject(err);
  }

  private read(): Promise<string[]> {
    if (this.queue.length) return Promise.resolve(this.queue.shift()!);
    if (this.closedError) return Promise.reject(this.closedError);
    return new Promise<string[]>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((w) => w.resolve !== wrapped);
        reject(new Error('El router no respondió a tiempo.'));
      }, this.creds.timeoutMs);
      const wrapped = (s: string[]) => {
        clearTimeout(timer);
        resolve(s);
      };
      this.waiters.push({ resolve: wrapped, reject: (e) => { clearTimeout(timer); reject(e); } });
    });
  }

  private write(sentence: string[]) {
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

  async talk(words: string[]): Promise<{ rows: string[][]; trapped?: string; done: boolean }> {
    this.write(words);
    const rows: string[][] = [];
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
    }
  }

  close() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
  }
}

// --- Cliente de tráfico (Simple Queues, PCQ, Address Lists) ---
export class MikrotikTrafficDriver {
  private client: MikrotikClient | null = null;
  private creds: RouterCreds;

  constructor(private router: any) {
    const port = Number(router.api_port) || 8728;
    const tls = port === 8729 || router.use_tls === true || router.use_tls === 'Sí' || router.use_tls === 'Si';
    this.creds = {
      host: String(router.ip_address || '').trim(),
      port,
      user: String(router.username || 'admin').trim(),
      password: String(router.password ?? ''),
      tls,
      timeoutMs: 8000,
    };
  }

  private async ensureClient(): Promise<MikrotikClient> {
    if (!this.client) {
      this.client = await MikrotikClient.connect(this.creds);
    }
    return this.client;
  }

  private async talk(words: string[]): Promise<string[][]> {
    const client = await this.ensureClient();
    const result = await client.talk(words);
    if (result.trapped) {
      throw new Error(`RouterOS respondió con error: ${result.trapped}`);
    }
    return result.rows;
  }

  // ============================================================
  // SIMPLE QUEUES
  // ============================================================

  async listSimpleQueues(): Promise<any[]> {
    const rows = await this.talk(['/queue/simple/print']);
    return rows.map(row => this.parseRow(row));
  }

  async createSimpleQueue(params: any): Promise<boolean> {
    const required = ['name', 'target', 'max_limit_up', 'max_limit_down'];
    for (const field of required) {
      if (params[field] === undefined || params[field] === '') {
        throw new Error(`Campo obligatorio: ${field}`);
      }
    }

    const args = [
      '=name=' + params.name,
      '=target=' + params.target,
      '=dst=' + (params.dst || '0.0.0.0/0'),
      '=max-limit=' + params.max_limit_up + '/' + params.max_limit_down,
    ];

    if (params.burst_limit) args.push('=burst-limit=' + params.burst_limit);
    if (params.burst_threshold) args.push('=burst-threshold=' + params.burst_threshold);
    if (params.burst_time) args.push('=burst-time=' + params.burst_time);
    if (params.priority) args.push('=priority=' + params.priority);
    if (params.queue_type) args.push('=queue=' + params.queue_type);
    if (params.parent) args.push('=parent=' + params.parent);
    if (params.comment) args.push('=comment=' + params.comment);

    await this.talk(['/queue/simple/add', ...args]);
    return true;
  }

  async updateSimpleQueue(name: string, params: any): Promise<boolean> {
    const args = ['=numbers=' + name];

    const map: Record<string, string> = {
      target: '=target=',
      dst: '=dst=',
      burst_limit: '=burst-limit=',
      burst_threshold: '=burst-threshold=',
      burst_time: '=burst-time=',
      priority: '=priority=',
      queue_type: '=queue=',
      parent: '=parent=',
      comment: '=comment=',
    };

    if (params.max_limit_up !== undefined || params.max_limit_down !== undefined) {
      const up = params.max_limit_up ?? '';
      const down = params.max_limit_down ?? '';
      if (up && down) {
        args.push('=max-limit=' + up + '/' + down);
      }
    }

    for (const [key, prefix] of Object.entries(map)) {
      if (params[key] !== undefined && params[key] !== '' && prefix) {
        args.push(prefix + params[key]);
      }
    }

    if (params.status) {
      args.push('=disabled=' + (params.status === 'disabled' ? 'yes' : 'no'));
    }

    await this.talk(['/queue/simple/set', ...args]);
    return true;
  }

  async removeSimpleQueue(name: string): Promise<boolean> {
    await this.talk(['/queue/simple/remove', '=numbers=' + name]);
    return true;
  }

  // ============================================================
  // PCQ PROFILES
  // ============================================================

  async listPcqProfiles(): Promise<any[]> {
    const rows = await this.talk(['/queue/type/print']);
    return rows.map(row => this.parseRow(row));
  }

  // ============================================================
  // ADDRESS LISTS
  // ============================================================

  async listAddressLists(): Promise<any[]> {
    const rows = await this.talk(['/ip/firewall/address-list/print']);
    return rows.map(row => this.parseRow(row));
  }

  async addAddressListEntry(listName: string, address: string, comment = ''): Promise<boolean> {
    const args = [
      '=list=' + listName,
      '=address=' + address,
    ];
    if (comment) args.push('=comment=' + comment);
    await this.talk(['/ip/firewall/address-list/add', ...args]);
    return true;
  }

  async removeAddressListEntry(listName: string, address: string): Promise<boolean> {
    const entries = await this.talk(['/ip/firewall/address-list/print', '?list=' + listName, '?address=' + address]);
    if (entries.length) {
      const entry = this.parseRow(entries[0]);
      const id = entry['.id'];
      if (id) {
        await this.talk(['/ip/firewall/address-list/remove', '=numbers=' + id]);
        return true;
      }
    }
    return false;
  }

  // ============================================================
  // MOROSO CUT / REACTIVATE
  // ============================================================

  async applyMorosoCut(pppoeUser: string, ipAddress: string, addressList = 'MOROSOS_ISP'): Promise<any> {
    const results: any = {};

    // 1. Agregar IP a Address List de morosos
    results.address_list = await this.addAddressListEntry(addressList, ipAddress, `Moroso: ${pppoeUser}`);

    // 2. Buscar y deshabilitar Simple Queue asociada
    const queues = await this.listSimpleQueues();
    for (const queue of queues) {
      if (queue.target && queue.target.includes(ipAddress)) {
        await this.updateSimpleQueue(queue.name, { status: 'disabled' });
        results.queue_disabled = queue.name;
        break;
      }
    }

    // 3. Deshabilitar usuario PPPoE
    try {
      await this.talk(['/ppp/secret/set', '=numbers=' + pppoeUser, '=disabled=yes']);
      results.pppoe_disabled = true;
    } catch (e: any) {
      results.pppoe_error = e.message;
    }

    // 4. Remover sesión activa PPPoE
    try {
      const active = await this.talk(['/ppp/active/print', '?name=' + pppoeUser]);
      if (active.length) {
        const activeEntry = this.parseRow(active[0]);
        const activeId = activeEntry['.id'];
        if (activeId) {
          await this.talk(['/ppp/active/remove', '=numbers=' + activeId]);
          results.session_kicked = true;
        }
      }
    } catch (e: any) {
      results.session_error = e.message;
    }

    return results;
  }

  async reactivateService(pppoeUser: string, ipAddress: string, addressList = 'MOROSOS_ISP', activeProfile = 'default'): Promise<any> {
    const results: any = {};

    // 1. Remover de Address List morosos
    results.address_list_removed = await this.removeAddressListEntry(addressList, ipAddress);

    // 2. Habilitar Simple Queue
    const queues = await this.listSimpleQueues();
    for (const queue of queues) {
      if (queue.target && queue.target.includes(ipAddress)) {
        await this.updateSimpleQueue(queue.name, { status: 'enabled' });
        results.queue_enabled = queue.name;
        break;
      }
    }

    // 3. Reactivar PPPoE
    try {
      await this.talk(['/ppp/secret/set', '=numbers=' + pppoeUser, '=disabled=no', '=profile=' + activeProfile]);
      results.pppoe_reactivated = true;
    } catch (e: any) {
      results.pppoe_error = e.message;
    }

    return results;
  }

  // --- Helper ---
  private parseRow(row: string[]): any {
    const obj: any = {};
    for (const word of row) {
      if (word.startsWith('=')) {
        const eq = word.indexOf('=', 1);
        if (eq > 0) {
          obj[word.slice(1, eq)] = word.slice(eq + 1);
        }
      }
    }
    return obj;
  }
}