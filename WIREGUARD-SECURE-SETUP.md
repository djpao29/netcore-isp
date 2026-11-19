# WireGuard Secure Setup para NetCore ISP

## 🔒 Principio de Seguridad Fundamental

> **El puerto de la API de RouterOS (8728/8729) NUNCA se expone a Internet.**
>
> Solo el puerto UDP 51820 (WireGuard) está abierto. Sin la clave privada correcta, el paquete es descartado silenciosamente - no hay respuesta, no hay "puerto cerrado", no hay información filtrada.

---

## Arquitectura de Seguridad

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERNET (PÚBLICO)                               │
│                                                                         │
│   ┌─────────────┐              UDP 51820              ┌─────────────┐  │
│   │  Tu App     │ ◄────── WireGuard (ChaCha20-Poly1305) ──────► │  Router    │  │
│   │  (Cliente)  │     Cifrado autenticado, sin handshake    │  MikroTik  │  │
│   └─────────────┘              visible                   └─────────────┘  │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        RED LAN DEL ROUTER (PRIVADA)                     │
│                                                                         │
│   Puerto 8728/8729 SOLO accesible desde:                               │
│   • 10.8.0.2 (IP del cliente en túnel WireGuard)                       │
│   • NO accesible desde Internet                                        │
│   • NO accesible desde LAN sin autenticación WireGuard                 │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Configuración Paso a Paso (Segura)

### 1. Generar claves en el CLIENTE (tu servidor NetCore)

```typescript
import { generateWireGuardSetup, generateWireGuardKeys } from './wireguard';

// En tu código de inicialización:
const setup = generateWireGuardSetup({
  routerPublicIP: 'router.tu-dominio.com',  // o IP pública fija
  routerWGPort: 51820,                       // Puerto WireGuard
  routerTunnelIP: '10.8.0.1/24',             # IP del router EN el túnel
  clientTunnelIP: '10.8.0.2/24',             # IP de tu app EN el túnel
  allowedIPs: ['10.8.0.1/32'],               # Solo permitir acceso a la IP del router
  persistentKeepalive: 25,                    # Mantener túnel vivo tras NAT
  usePresharedKey: true,                     # Capa extra de seguridad
});

// GUARDA ESTAS CLAVES DE FORMA SEGURA (variables de entorno, vault, etc.)
console.log('CLIENTE PrivateKey:', setup.clientKeys.privateKey);
console.log('CLIENTE PublicKey:', setup.clientKeys.publicKey);
console.log('PresharedKey:', setup.presharedKey);
```

### 2. Configurar el ROUTER (MikroTik) - Solo una vez

Copia y pega en terminal del router (Winbox/SSH):

```routeros
# 1. Crear interfaz WireGuard
/interface/wireguard/add name=wg-mgmt listen-port=51820 mtu=1420

# 2. Asignar IP al túnel
/ip/address/add address=10.8.0.1/24 interface=wg-mgmt

# 3. Agregar peer (tu app) - USA LA PUBLIC KEY DEL CLIENTE
/interface/wireguard/peers/add \
    interface=wg-mgmt \
    public-key="PEGAR_CLIENT_PUBLIC_KEY_AQUI" \
    allowed-address=10.8.0.2/32 \
    persistent-keepalive=25 \
    preshared-key="PEGAR_PRESHARED_KEY_AQUI"

# 4. FIREWALL CRÍTICO - Solo permitir API desde túnel WireGuard
/ip/firewall/filter/add chain=input action=accept protocol=tcp dst-port=8728 src-address=10.8.0.2 comment="API via WireGuard ONLY"
/ip/firewall/filter/add chain=input action=accept protocol=udp dst-port=51820 comment="WireGuard"

# 5. BLOQUEAR acceso directo a API desde cualquier otro lado
/ip/firewall/filter/add chain=input action=drop protocol=tcp dst-port=8728 comment="Block direct API access"
/ip/firewall/filter/add chain=input action=drop protocol=tcp dst-port=8729 comment="Block direct API TLS"

# 6. Ver la clave pública del router (para completar config cliente)
/interface/wireguard/print show-keys
```

### 3. Completar configuración del CLIENTE

```typescript
// Toma la clave pública del router del paso 6 anterior
const routerPublicKey = 'ROUTER_PUBLIC_KEY_DEL_PASO_6';

// Actualiza la config del cliente con la clave real del router
const clientConfig = createClientConfig(
  setup.clientKeys,
  routerPublicKey,                    // <-- CLAVE REAL DEL ROUTER
  'router.tu-dominio.com:51820',      // endpoint
  '10.8.0.2/24',                      // client tunnel IP
  '10.8.0.1',                         // router tunnel IP
  ['10.8.0.1/32'],                    // allowed IPs (solo router)
  25,                                 // keepalive
  setup.presharedKey                  // preshared key
);
```

### 4. Usar en tu código

```typescript
import { runRouterTool, testRouterConnection } from './mikrotik';

const creds = {
  host: 'router.tu-dominio.com',      // Se ignora si usa WireGuard (usa routerTunnelIP)
  user: 'admin',
  password: 'tu-password-seguro',
  wireguard: {
    config: clientConfig,
    routerTunnelIP: '10.8.0.1',       // IP del router DENTRO del túnel
    interfaceName: 'wg-mikrotik',
    preferSystemWG: true,             // Usa wireguard-tools del sistema (kernel)
  }
};

// Ahora TODAS las llamadas van por túnel cifrado
const result = await testRouterConnection(creds);
console.log(result); // { ok: true, identity: 'MiRouter', ... }

// Ejemplo: gestionar PPPoE
await runRouterTool(creds, 'ppp-active', 'MiRouter');
await setPppoeEnabled(creds, 'cliente_101', false); // Cortar servicio
```

---

## Checklist de Seguridad ✅

| Comprobación | Cómo verificar |
|--------------|----------------|
| **Puerto 8728/8729 cerrado a Internet** | `nmap -p 8728,8729 router.tu-dominio.com` → `filtered` |
| **Puerto 51820 UDP abierto** | `nmap -sU -p 51820 router.tu-dominio.com` → `open|filtered` |
| **API solo accesible via túnel** | Desde Internet: `telnet router.tu-dominio.com 8728` → timeout |
| **Handshake WireGuard funciona** | `/interface/wireguard/peers/print` → `latest-handshake` reciente |
| **Firewall bloquea API directa** | `/ip/firewall/filter/print` → reglas de drop en puertos 8728/8729 |
| **Claves rotadas periódicamente** | Regenerar claves cada 90 días (ver abajo) |

---

## Rotación de Claves (Cada 90 días)

```bash
# 1. Generar nuevas claves en cliente
# 2. Actualizar peer en router:
/interface/wireguard/peers/set [find public-key="OLD_KEY"] public-key="NEW_CLIENT_PUBLIC_KEY" preshared-key="NEW_PRESHARED_KEY"

# 3. Actualizar config en cliente con nueva router public key (si cambió)
# 4. Reiniciar túnel: wg-quick down wg-mikrotik && wg-quick up wg-mikrotik
```

---

## Por qué esto es seguro

| Amenaza | Mitigación WireGuard |
|---------|---------------------|
| **Escaneo de puertos** | Puerto 51820 no responde sin clave válida (silencio total) |
| **Fuerza bruta API** | API en 8728 inalcanzable desde Internet |
| **Man-in-the-middle** | ChaCha20-Poly1305 AEAD - integridad + confidencialidad |
| **Replay attacks** | Contadores de 64-bit por paquete, nunca se repiten |
| **Key compromise** | Perfect Forward Secrecy - claves de sesión efímeras |
| **DDoS en API** | Tráfico descartado antes de llegar a proceso API |
| **Filtración de metadata** | Tráfico indistinguible de ruido aleatorio |

---

## Requisitos del Sistema

- **Linux**: `wireguard-tools` (wg, wg-quick) - kernel 5.6+ tiene WireGuard nativo
- **Windows**: WireGuard para Windows (usuario) o WSL2
- **Docker**: `--cap-add=NET_ADMIN --cap-add=SYS_MODULE` + `modprobe wireguard`

```bash
# Ubuntu/Debian
apt update && apt install wireguard

# Verificar
wg --version
# wireguard-tools v1.0.20210914 - wireguard kernel module loaded
```

---

## Troubleshooting

| Problema | Solución |
|----------|----------|
| `wg-quick: command not found` | Instalar `wireguard-tools` |
| `RTNETLINK answers: Operation not permitted` | Ejecutar como root o `CAP_NET_ADMIN` |
| Handshake no completa | Verificar: endpoint correcto, puertos UDP abiertos, claves coinciden |
| Timeout API | Verificar firewall router: `/ip/firewall/filter/print` - regla accept src=10.8.0.2 dst-port=8728 |
| `wg show` vacío | `wg-quick up /ruta/config.conf` falló - revisar logs `journalctl -u wg-quick@wg-mikrotik` |

---

## Referencia Rápida de Comandos RouterOS

```routeros
# Ver estado túnel
/interface/wireguard/peers/print detail

# Ver handshakes
/interface/wireguard/peers/print where interface=wg-mgmt

# Ver tráfico
/interface/wireguard/peers/print stats

# Reiniciar peer (forzar re-handshake)
/interface/wireguard/peers/disable [find interface=wg-mgmt]
/interface/wireguard/peers/enable [find interface=wg-mgmt]

# Ver claves
/interface/wireguard/print show-keys
```

---

**⚠️ NUNCA:**
- Compartas claves privadas por chat, email, git
- Exponas 8728/8729 en firewall de borde
- Uses claves débiles o reutilizadas
- Desactives el firewall en el router

**✅ SIEMPRE:**
- Usa preshared-key (capa extra post-cuántica)
- Rotas claves cada 90 días
- Monitoreas handshakes en logs
- Mantienes wireguard-tools actualizado