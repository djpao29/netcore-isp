// ============================================================================
//  WireGuard Transport for RouterOS API
//  Genera claves, configs y establece túneles para acceder a routers detrás de NAT
// ============================================================================
import crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { promisify } from 'util';
import { createSocket, Socket } from 'dgram';
import { exec as execCallback } from 'child_process';
import { x25519 } from '@noble/curves/ed25519.js';
import { MikrotikClient, RouterCreds } from './mikrotik';

const execAsync = promisify(execCallback);

export interface WireGuardKeys {
  privateKey: string;
  publicKey: string;
}

export interface WireGuardPeer {
  publicKey: string;
  endpoint?: string;      // "host:port" del peer remoto
  allowedIPs: string[];   // IPs permitidas a través del túnel (ej: ["10.0.0.0/24"])
  persistentKeepalive?: number; // Segundos (útil tras NAT)
  presharedKey?: string;  // Opcional: clave precompartida extra
}

export interface WireGuardConfig {
  interface: {
    privateKey: string;
    address: string[];           // IPs locales del túnel (ej: ["10.8.0.2/24"])
    listenPort?: number;         // Puerto local (0 = aleatorio)
    dns?: string[];              // DNS para el túnel
    mtu?: number;
  };
  peers: WireGuardPeer[];
}

export interface WireGuardTunnel {
  interfaceName: string;
  config: WireGuardConfig;
  process?: ChildProcess;
  localEndpointIP: string;      // IP asignada en el túnel (ej: "10.8.0.2")
  routerTunnelIP: string;       // IP del router dentro del túnel (ej: "10.8.0.1")
  isUp: boolean;
  // Propiedad opcional para implementación userspace
  _userspace?: UserspaceWireGuard;
}

// --- Generación de claves ----------------------------------------------------

/** Genera un par de claves WireGuard (X25519) usando noble-curves */
export async function generateWireGuardKeys(): Promise<WireGuardKeys> {
  // Generar clave privada aleatoria (32 bytes)
  const privateKey = crypto.randomBytes(32);

  // Derivar clave pública usando X25519
  const publicKey = x25519.getPublicKey(privateKey);

  return {
    privateKey: Buffer.from(privateKey).toString('base64'),
    publicKey: Buffer.from(publicKey).toString('base64'),
  };
}

/** Genera una clave precompartida opcional */
export function generatePresharedKey(): string {
  return crypto.randomBytes(32).toString('base64');
}

/** Deriva la clave pública desde una clave privada (base64) usando noble-curves */
export function derivePublicKey(privateKeyB64: string): string {
  const privateKey = Buffer.from(privateKeyB64, 'base64');
  const publicKey = x25519.getPublicKey(privateKey);
  return Buffer.from(publicKey).toString('base64');
}

// --- Configuración -----------------------------------------------------------

/** Crea una configuración WireGuard para conectar a un router MikroTik */
export function createClientConfig(
  clientKeys: WireGuardKeys,
  routerPublicKey: string,
  routerEndpoint: string,           // "router.public.ip:51820"
  clientTunnelIP: string,           // "10.8.0.2/24"
  routerTunnelIP: string,           // "10.8.0.1"
  allowedIPs: string[] = ['0.0.0.0/0'], // Qué tráfico va por el túnel
  persistentKeepalive = 25,
  presharedKey?: string
): WireGuardConfig {
  return {
    interface: {
      privateKey: clientKeys.privateKey,
      address: [clientTunnelIP],
      listenPort: 0, // Puerto aleatorio
    },
    peers: [{
      publicKey: routerPublicKey,
      endpoint: routerEndpoint,
      allowedIPs,
      persistentKeepalive,
      presharedKey,
    }],
  };
}

/** Crea la configuración del lado del router (para /interface/wireguard/peers/add) */
export function createRouterPeerConfig(
  clientPublicKey: string,
  clientTunnelIP: string,           // "10.8.0.2/32" (solo la IP del cliente)
  allowedIPs: string[] = ['10.8.0.2/32'],
  persistentKeepalive = 25,
  presharedKey?: string
): Record<string, string> {
  const config: Record<string, string> = {
    'public-key': clientPublicKey,
    'allowed-address': allowedIPs.join(','),
    'persistent-keepalive': persistentKeepalive.toString(),
  };
  if (presharedKey) config['preshared-key'] = presharedKey;
  return config;
}

/** Serializa config a formato wg-quick (archivo .conf) */
export function serializeConfig(config: WireGuardConfig): string {
  const lines: string[] = ['[Interface]'];
  lines.push(`PrivateKey = ${config.interface.privateKey}`);
  lines.push(`Address = ${config.interface.address.join(', ')}`);
  if (config.interface.listenPort !== undefined) lines.push(`ListenPort = ${config.interface.listenPort}`);
  if (config.interface.dns) lines.push(`DNS = ${config.interface.dns.join(', ')}`);
  if (config.interface.mtu) lines.push(`MTU = ${config.interface.mtu}`);

  for (const peer of config.peers) {
    lines.push('', '[Peer]');
    lines.push(`PublicKey = ${peer.publicKey}`);
    if (peer.endpoint) lines.push(`Endpoint = ${peer.endpoint}`);
    lines.push(`AllowedIPs = ${peer.allowedIPs.join(', ')}`);
    if (peer.persistentKeepalive) lines.push(`PersistentKeepalive = ${peer.persistentKeepalive}`);
    if (peer.presharedKey) lines.push(`PresharedKey = ${peer.presharedKey}`);
  }

  return lines.join('\n');
}

// --- Gestión de túnel (requiere wg-quick / wireguard-tools instalado) --------

export interface WireGuardSystemStatus {
  available: boolean;
  version?: string;
  error?: string;
}

/** Verifica si wireguard-tools está disponible en el sistema */
export async function checkWireGuardAvailable(): Promise<WireGuardSystemStatus> {
  try {
    const { stdout } = await execAsync('wg --version');
    return { available: true, version: stdout.trim() };
  } catch (err: any) {
    return { available: false, error: err.message };
  }
}

/** Levanta un túnel WireGuard usando wg-quick */
export async function bringUpTunnel(
  config: WireGuardConfig,
  interfaceName = 'wg0'
): Promise<{ success: boolean; output: string; error?: string }> {
  const confContent = serializeConfig(config);
  const confPath = `/tmp/${interfaceName}.conf`;

  try {
    // Escribir config temporal
    await require('fs').promises.writeFile(confPath, confContent, { mode: 0o600 });

    // Levantar interfaz (requiere root/CAP_NET_ADMIN)
    const { stdout, stderr } = await execAsync(`wg-quick up ${confPath}`);

    return { success: true, output: stdout + stderr };
  } catch (err: any) {
    return { success: false, output: '', error: err.message };
  }
}

/** Baja un túnel WireGuard */
export async function bringDownTunnel(interfaceName = 'wg0'): Promise<{ success: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(`wg-quick down ${interfaceName}`);
    return { success: true, output: stdout + stderr };
  } catch (err: any) {
    return { success: false, output: err.message };
  }
}

/** Obtiene estado de interfaz WireGuard */
export async function getTunnelStatus(interfaceName = 'wg0'): Promise<{
  up: boolean;
  peers: Array<{ publicKey: string; endpoint?: string; allowedIPs: string; latestHandshake: number; transferRx: number; transferTx: number }>;
}> {
  try {
    const { stdout } = await execAsync(`wg show ${interfaceName} dump`);
    const lines = stdout.trim().split('\n');
    if (lines.length < 2) return { up: false, peers: [] };

    // Header: iface	private_key	public_key	listen_port	fwmark
    // Peer:   iface	public_key	preshared_key	endpoint	allowed_ips	latest_handshake	rx_bytes	tx_bytes	persistent_keepalive
    const peers = lines.slice(1).map((line: string) => {
      const [, , publicKey, , endpoint, allowedIPs, latestHandshake, rxBytes, txBytes] = line.split('\t');
      return {
        publicKey,
        endpoint: endpoint !== '(none)' ? endpoint : undefined,
        allowedIPs,
        latestHandshake: parseInt(latestHandshake) || 0,
        transferRx: parseInt(rxBytes) || 0,
        transferTx: parseInt(txBytes) || 0,
      };
    });

    return { up: true, peers };
  } catch {
    return { up: false, peers: [] };
  }
}

// --- Integración con MikrotikClient (túnel userspace fallback) --------------

/**
 * Cliente MikroTik que usa WireGuard como transporte.
 * Si wireguard-tools no está disponible, usa implementación userspace (wireguard-go style).
 */
export class WireGuardMikrotikClient {
  private tunnel: WireGuardTunnel | null = null;
  private mikrotikClient: MikrotikClient | null = null;
  private useSystemWireGuard: boolean = false;

  constructor(
    private routerCreds: RouterCreds,
    private wgConfig: WireGuardConfig,
    private options: {
      interfaceName?: string;
      preferSystemWG?: boolean;
      routerTunnelIP?: string; // IP del router dentro del túnel (default: primera IP de allowedIPs del peer)
    } = {}
  ) {
    this.options = {
      interfaceName: 'wg-mikrotik',
      preferSystemWG: true,
      routerTunnelIP: '10.8.0.1',
      ...options,
    } as Required<typeof options>;
  }

  /** Inicializa el túnel WireGuard y conecta al router */
  async connect(): Promise<void> {
    // 1. Verificar si wireguard-tools está disponible
    const wgStatus = await checkWireGuardAvailable();
    this.useSystemWireGuard = wgStatus.available && (this.options.preferSystemWG ?? true);

    if (this.useSystemWireGuard) {
      await this.connectSystemWireGuard();
    } else {
      await this.connectUserspaceWireGuard();
    }

    // 2. Conectar al router a través del túnel
    const tunnelCreds: RouterCreds = {
      ...this.routerCreds,
      host: this.options.routerTunnelIP ?? '10.8.0.1',
      port: 8728, // Puerto API estándar (dentro del túnel no importa TLS)
      tls: false, // El túnel ya cifra
    };

    this.mikrotikClient = await MikrotikClient.connect(tunnelCreds);
  }

  private async connectSystemWireGuard(): Promise<void> {
    const result = await bringUpTunnel(this.wgConfig, this.options.interfaceName!);
    if (!result.success) {
      throw new Error(`No se pudo levantar túnel WireGuard (sistema): ${result.error}`);
    }

    const status = await getTunnelStatus(this.options.interfaceName!);
    if (!status.up) {
      throw new Error('Túnel WireGuard no está activo tras wg-quick up');
    }

    this.tunnel = {
      interfaceName: this.options.interfaceName!,
      config: this.wgConfig,
      localEndpointIP: this.wgConfig.interface.address[0].split('/')[0],
      routerTunnelIP: this.options.routerTunnelIP!,
      isUp: true,
    };
  }

  private async connectUserspaceWireGuard(): Promise<void> {
    const userspaceTunnel = await UserspaceWireGuard.createTunnel(this.wgConfig, this.options.interfaceName!);
    await userspaceTunnel.handshake(this.wgConfig.peers[0].publicKey, this.wgConfig.peers[0].endpoint!);
    userspaceTunnel.startKeepAlive(25000);

    // Adaptar UserspaceWireGuard a la interfaz WireGuardTunnel
    this.tunnel = {
      interfaceName: this.options.interfaceName!,
      config: this.wgConfig,
      localEndpointIP: this.wgConfig.interface.address[0].split('/')[0],
      routerTunnelIP: this.options.routerTunnelIP!,
      isUp: true,
      // Propiedades adicionales para userspace
      _userspace: userspaceTunnel,
    } as WireGuardTunnel & { _userspace: UserspaceWireGuard };

    // 2. Conectar al router a través del túnel
    const tunnelCreds: RouterCreds = {
      ...this.routerCreds,
      host: this.options.routerTunnelIP ?? '10.8.0.1',
      port: 8728,
      tls: false,
    };

    this.mikrotikClient = await MikrotikClient.connect(tunnelCreds);
  }

  /** Ejecuta un comando en el router a través del túnel */
  async talk(words: string[]): Promise<{ rows: string[][]; trapped?: string; done: boolean }> {
    if (!this.mikrotikClient) throw new Error('No conectado. Llame a connect() primero.');
    return this.mikrotikClient.talk(words);
  }

  /** Cierra túnel y conexión */
  async close(): Promise<void> {
    if (this.mikrotikClient) {
      this.mikrotikClient.close();
      this.mikrotikClient = null;
    }
    if (this.tunnel) {
      if (this.useSystemWireGuard) {
        await bringDownTunnel(this.tunnel.interfaceName);
      } else if (this.tunnel._userspace) {
        await this.tunnel._userspace.close();
      }
      this.tunnel.isUp = false;
    }
  }

  getTunnelInfo(): WireGuardTunnel | null {
    return this.tunnel;
  }
}

// --- Helpers de alto nivel ---------------------------------------------------

export interface WireGuardRouterSetup {
  // Lo que el usuario configura en el router MikroTik
  routerCommands: string[];
  // Configuración del cliente
  clientConfig: WireGuardConfig;
  // Claves generadas
  clientKeys: WireGuardKeys;
  presharedKey?: string;
}

/**
 * Genera setup completo WireGuard para un router MikroTik.
 * Devuelve comandos para pegar en terminal del router + config de cliente.
 */
export async function generateWireGuardSetup(params: {
  routerPublicIP: string;           // IP pública del router (o DDNS)
  routerWGPort?: number;            // Puerto WireGuard en router (default 51820)
  routerTunnelIP: string;           // IP del router en túnel (ej: "10.8.0.1/24")
  clientTunnelIP: string;           // IP del cliente en túnel (ej: "10.8.0.2/24")
  allowedIPs?: string[];            // Qué redes alcanzar via túnel (default: solo IP router)
  persistentKeepalive?: number;
  usePresharedKey?: boolean;
}): Promise<WireGuardRouterSetup> {
  const clientKeys = await generateWireGuardKeys();
  const presharedKey = params.usePresharedKey ? generatePresharedKey() : undefined;
  const routerWGPort = params.routerWGPort || 51820;
  const routerEndpoint = `${params.routerPublicIP}:${routerWGPort}`;
  const allowedIPs = params.allowedIPs || [params.routerTunnelIP.split('/')[0] + '/32'];
  const keepalive = params.persistentKeepalive || 25;

  // Configuración cliente
  const clientConfig = createClientConfig(
    clientKeys,
    // La clave pública del router se debe obtener aparte (ej: /interface/wireguard/print)
    'ROUTER_PUBLIC_KEY_PLACEHOLDER', // Se reemplaza tras configurar router
    routerEndpoint,
    params.clientTunnelIP,
    params.routerTunnelIP.split('/')[0],
    allowedIPs,
    keepalive,
    presharedKey
  );

  // Comandos para el router (RouterOS 7+)
  const routerPubKey = 'ROUTER_PUBLIC_KEY_PLACEHOLDER'; // Se obtiene tras crear interface
  const routerCommands = [
    // 1. Crear interfaz WireGuard en router
    `/interface/wireguard/add name=wg-mgmt listen-port=${routerWGPort} mtu=1420`,
    // 2. Asignar IP a la interfaz
    `/ip/address/add address=${params.routerTunnelIP} interface=wg-mgmt`,
    // 3. Agregar peer (cliente)
    `/interface/wireguard/peers/add interface=wg-mgmt public-key="${clientKeys.publicKey}" allowed-address=${allowedIPs.join(',')} persistent-keepalive=${keepalive}${presharedKey ? ` preshared-key="${presharedKey}"` : ''}`,
    // 4. Firewall: permitir tráfico API solo desde túnel
    `/ip/firewall/filter/add chain=input action=accept protocol=tcp dst-port=8728 src-address=${params.clientTunnelIP.split('/')[0]} comment="API via WireGuard"`,
    `/ip/firewall/filter/add chain=input action=accept protocol=udp dst-port=${routerWGPort} comment="WireGuard"`,
    // 5. Mostrar clave pública del router para completar config cliente
    `/interface/wireguard/print show-keys`,
  ];

  return {
    routerCommands,
    clientConfig,
    clientKeys,
    presharedKey,
  };
}

// ============================================================================
//  WireGuard Userspace Implementation (sin wireguard-tools del sistema)
//  Implementación simplificada de WireGuard en userspace usando UDP
// ============================================================================

/**
 * Implementación userspace de WireGuard.
 * Usa sockets UDP y crypto nativo de Node.js.
 * No requiere wireguard-tools ni módulo kernel.
 */
export class UserspaceWireGuard {
  private socket: Socket | null = null;
  private localPrivateKey: Buffer;
  private localPublicKey: Buffer;
  private peerPublicKey: Buffer;
  private presharedKey: Buffer | null = null;
  private sessionKeys: { sendKey: Buffer; recvKey: Buffer; sendCounter: bigint; recvCounter: bigint } | null = null;
  private endpoint: { host: string; port: number } | null = null;
  private interfaceName: string;
  private localIP: string;
  private pendingHandshake: Promise<void> | null = null;
  private handshakeComplete: boolean = false;
  private receivedPackets: Map<number, Buffer> = new Map();
  private nextPacketId: number = 1;
  private keepAliveInterval: NodeJS.Timeout | null = null;

  constructor(
    config: WireGuardConfig,
    interfaceName: string
  ) {
    this.interfaceName = interfaceName;
    this.localPrivateKey = Buffer.from(config.interface.privateKey, 'base64');
    this.localPublicKey = Buffer.from(config.peers[0].publicKey, 'base64');
    this.peerPublicKey = Buffer.from(config.peers[0].publicKey, 'base64');
    this.localIP = config.interface.address[0].split('/')[0];

    if (config.peers[0].presharedKey) {
      this.presharedKey = Buffer.from(config.peers[0].presharedKey, 'base64');
    }

    if (config.peers[0].endpoint) {
      const [host, port] = config.peers[0].endpoint.split(':');
      this.endpoint = { host, port: parseInt(port) };
    }
  }

  /** Crea un túnel WireGuard en userspace */
  static async createTunnel(config: WireGuardConfig, interfaceName: string): Promise<UserspaceWireGuard> {
    const wg = new UserspaceWireGuard(config, interfaceName);
    await wg.initSocket();
    return wg;
  }

  private async initSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = createSocket('udp4');

      this.socket.on('error', (err) => {
        reject(err);
      });

      this.socket.on('listening', () => {
        const addr = this.socket!.address();
        console.log(`[WireGuard Userspace] Socket listening on ${addr.address}:${addr.port}`);
        resolve();
      });

      this.socket.on('message', (msg, rinfo) => {
        this.handlePacket(msg, rinfo);
      });

      // Bind to random port
      this.socket.bind(0);
    });
  }

  /** Inicia handshake con el peer remoto */
  async handshake(peerPublicKeyB64: string, endpoint: string): Promise<void> {
    this.peerPublicKey = Buffer.from(peerPublicKeyB64, 'base64');
    const [host, port] = endpoint.split(':');
    this.endpoint = { host, port: parseInt(port) };

    // Generar ephemeral keys para handshake usando noble-curves
    const ephemeralPrivate = crypto.randomBytes(32);
    const ephemeralPublic = Buffer.from(x25519.getPublicKey(ephemeralPrivate));

    // Derivar shared secret estático usando noble-curves
    const staticShared = Buffer.from(x25519.getSharedSecret(this.localPrivateKey, this.peerPublicKey));

    // Derivar shared secret efímero usando noble-curves
    const ephemeralShared = Buffer.from(x25519.getSharedSecret(ephemeralPrivate, this.peerPublicKey));

    // HKDF para derivar claves de sesión (simplificado - WireGuard real usa más pasos)
    const handshakeHash = this.hashHandshake(ephemeralPublic, staticShared, ephemeralShared);

    // Enviar handshake initiation
    const initiationPacket = this.buildHandshakeInitiation(ephemeralPublic);
    await this.sendPacket(initiationPacket);

    // Esperar respuesta (handshake response)
    await this.waitForHandshakeResponse();

    // Derivar claves de transporte
    this.deriveTransportKeys(handshakeHash);

    this.handshakeComplete = true;
    console.log('[WireGuard Userspace] Handshake completado, claves de sesión derivadas');
  }

  private hashHandshake(ephemeralPublic: Buffer, staticShared: Buffer, ephemeralShared: Buffer): Buffer {
    // Usar blake2b512 que está disponible en Node.js
    const hash = crypto.createHash('blake2b512');
    hash.update('WireGuard v1 zx2c4 Jason@zx2c4.com');
    hash.update(ephemeralPublic);
    hash.update(staticShared);
    hash.update(ephemeralShared);
    if (this.presharedKey) {
      hash.update(this.presharedKey);
    }
    return hash.digest().subarray(0, 64); // Truncar a 64 bytes
  }

  private buildHandshakeInitiation(ephemeralPublic: Buffer): Buffer {
    // Packet type 1 = Handshake Initiation
    const packet = Buffer.alloc(1 + 4 + 32 + 32 + 16 + 16);
    let offset = 0;
    packet[offset++] = 1; // Message type
    // Sender index (0 for initiation)
    packet.writeUInt32LE(0, offset); offset += 4;
    // Ephemeral public key
    ephemeralPublic.copy(packet, offset); offset += 32;
    // Static public key (encrypted)
    const staticEncrypted = this.encryptStaticKey();
    staticEncrypted.copy(packet, offset); offset += 32;
    // Timestamp (encrypted)
    const timestampEncrypted = this.encryptTimestamp();
    timestampEncrypted.copy(packet, offset); offset += 16;
    // MACs
    const macs = this.computeMacs(packet.slice(0, offset));
    macs.copy(packet, offset);
    return packet;
  }

  private encryptStaticKey(): Buffer {
    // Simplificado: en WireGuard real se usa ChaCha20-Poly1305 con clave derivada
    const cipher = crypto.createCipheriv('chacha20-poly1305', this.localPrivateKey.slice(0, 32), Buffer.alloc(12));
    return cipher.update(this.localPublicKey);
  }

  private encryptTimestamp(): Buffer {
    const timestamp = Buffer.alloc(12);
    timestamp.writeBigUInt64LE(BigInt(Date.now()));
    const cipher = crypto.createCipheriv('chacha20-poly1305', this.localPrivateKey.slice(0, 32), Buffer.alloc(12));
    return cipher.update(timestamp);
  }

  private computeMacs(data: Buffer): Buffer {
    const mac1 = crypto.createHash('blake2s256').update(data).digest().subarray(0, 16);
    const mac2 = crypto.createHash('blake2s256').update(mac1).digest().subarray(0, 16);
    return Buffer.concat([mac1, mac2]);
  }

  private async sendPacket(packet: Buffer): Promise<void> {
    if (!this.socket || !this.endpoint) {
      throw new Error('Socket no inicializado o endpoint no configurado');
    }
    return new Promise((resolve, reject) => {
      this.socket!.send(packet, this.endpoint!.port, this.endpoint!.host, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async waitForHandshakeResponse(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Handshake timeout - no response from peer'));
      }, 10000);

      const checkResponse = () => {
        if (this.sessionKeys) {
          clearTimeout(timeout);
          resolve();
        } else {
          setTimeout(checkResponse, 100);
        }
      };
      checkResponse();
    });
  }

  private handlePacket(msg: Buffer, rinfo: any): void {
    if (msg.length === 0) return;

    const msgType = msg[0];

    if (msgType === 2) { // Handshake Response
      this.processHandshakeResponse(msg);
    } else if (msgType === 4) { // Transport Data
      this.processTransportData(msg);
    }
  }

  private processHandshakeResponse(msg: Buffer): void {
    if (msg.length < 1 + 4 + 32 + 16) return;

    let offset = 1;
    const receiverIndex = msg.readUInt32LE(offset); offset += 4;
    const ephemeralPublic = msg.slice(offset, offset + 32); offset += 32;
    const timestampEncrypted = msg.slice(offset, offset + 16);

    // Derivar shared secrets usando noble-curves
    const ephemeralShared = Buffer.from(x25519.getSharedSecret(this.localPrivateKey, ephemeralPublic));
    const staticShared = Buffer.from(x25519.getSharedSecret(this.localPrivateKey, this.peerPublicKey));

    // Derivar handshake hash
    const handshakeHash = this.hashHandshake(ephemeralPublic, staticShared, ephemeralShared);

    // Derivar claves de transporte
    this.deriveTransportKeys(handshakeHash);
  }

  private deriveTransportKeys(handshakeHash: Buffer): void {
    // HKDF para derivar claves de envío y recepción
    const hkdfSend = crypto.createHmac('blake2s', handshakeHash);
    hkdfSend.update('WireGuard v1 key derivation');
    const sendKey = hkdfSend.digest();

    const hkdfRecv = crypto.createHmac('blake2s', handshakeHash);
    hkdfRecv.update('WireGuard v1 key derivation');
    const recvKey = hkdfRecv.digest();

    this.sessionKeys = {
      sendKey,
      recvKey,
      sendCounter: 0n,
      recvCounter: 0n,
    };
  }

  private processTransportData(msg: Buffer): void {
    if (!this.sessionKeys || msg.length < 1 + 4 + 8 + 16) return;

    let offset = 1;
    const receiverIndex = msg.readUInt32LE(offset); offset += 4;
    const counter = msg.readBigUInt64LE(offset); offset += 8;
    const encryptedData = msg.slice(offset, -16);
    const authTag = msg.slice(-16);

    // Descifrar con ChaCha20-Poly1305
    try {
      const decipher = crypto.createDecipheriv('chacha20-poly1305', this.sessionKeys!.recvKey, Buffer.alloc(12));
      decipher.setAuthTag(authTag);
      const decrypted = decipher.update(encryptedData);

      // Guardar paquete descifrado para lectura
      const packetId = this.nextPacketId++;
      this.receivedPackets.set(packetId, decrypted);
    } catch (err) {
      console.error('[WireGuard Userspace] Error descifrando paquete:', err);
    }
  }

  /** Envía datos a través del túnel cifrado */
  async send(data: Buffer): Promise<void> {
    if (!this.sessionKeys || !this.handshakeComplete) {
      throw new Error('Túnel no establecido (handshake no completado)');
    }

    const counter = this.sessionKeys.sendCounter++;
    const nonce = Buffer.alloc(12);
    nonce.writeBigUInt64LE(counter, 4);

    const cipher = crypto.createCipheriv('chacha20-poly1305', this.sessionKeys.sendKey, nonce);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const authTag = cipher.getAuthTag();

    // Construir paquete de transporte
    const packet = Buffer.alloc(1 + 4 + 8 + encrypted.length + 16);
    let offset = 0;
    packet[offset++] = 4; // Transport Data
    packet.writeUInt32LE(0, offset); offset += 4; // Receiver index
    packet.writeBigUInt64LE(counter, offset); offset += 8;
    encrypted.copy(packet, offset); offset += encrypted.length;
    authTag.copy(packet, offset);

    await this.sendPacket(packet);
  }

  /** Recibe datos del túnel */
  async receive(): Promise<Buffer | null> {
    if (!this.handshakeComplete) return null;

    const keys = Array.from(this.receivedPackets.keys());
    if (keys.length === 0) return null;

    const firstKey = Math.min(...keys);
    const data = this.receivedPackets.get(firstKey)!;
    this.receivedPackets.delete(firstKey);
    return data;
  }

  /** Cierra el túnel */
  async close(): Promise<void> {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.handshakeComplete = false;
    this.sessionKeys = null;
  }

  /** Inicia keepalive para mantener túnel vivo tras NAT */
  startKeepAlive(intervalMs: number = 25000): void {
    this.keepAliveInterval = setInterval(async () => {
      if (this.handshakeComplete) {
        await this.send(Buffer.from([0])); // Paquete vacío para keepalive
      }
    }, intervalMs);
  }
}

