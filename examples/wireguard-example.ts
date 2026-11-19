// ============================================================================
//  Ejemplo de uso WireGuard para NetCore ISP
//  Muestra cómo configurar y usar túnel WireGuard con MikroTik
// ============================================================================
import {
  generateWireGuardSetup,
  createClientConfig,
  generateWireGuardKeys,
  derivePublicKey,
  generatePresharedKey,
  WireGuardMikrotikClient,
  WireGuardConfig,
  WireGuardKeys,
} from '../wireguard';
import { runRouterTool, testRouterConnection, setPppoeEnabled, RouterCreds } from '../mikrotik';

// ============================================================================
//  CONFIGURACIÓN - Cambia estos valores para tu entorno
// ============================================================================
const CONFIG = {
  // Router
  routerPublicIP: 'router.mi-dominio.com',     // IP pública o DDNS del router
  routerWGPort: 51820,                          // Puerto WireGuard en router

  // Red del túnel (subred /24 recomendada)
  routerTunnelIP: '10.8.0.1/24',                // IP del router EN el túnel
  clientTunnelIP: '10.8.0.2/24',                // IP de este cliente EN el túnel

  // Credenciales RouterOS API
  routerUser: 'admin',
  routerPassword: 'mi-password-seguro',

  // Seguridad
  usePresharedKey: true,                        // Capa extra post-cuántica
  persistentKeepalive: 25,                      // Segundos (mantiene túnel vivo tras NAT)

  // Interface
  interfaceName: 'wg-mikrotik',
};

// ============================================================================
//  PASO 1: Generar setup completo (ejecutar UNA VEZ)
// ============================================================================
async function generateSetup() {
  console.log('🔧 Generando configuración WireGuard...\n');

  const setup = await generateWireGuardSetup({
    routerPublicIP: CONFIG.routerPublicIP,
    routerWGPort: CONFIG.routerWGPort,
    routerTunnelIP: CONFIG.routerTunnelIP,
    clientTunnelIP: CONFIG.clientTunnelIP,
    allowedIPs: ['10.8.0.1/32'], // Solo permitir acceso a la IP del router
    persistentKeepalive: CONFIG.persistentKeepalive,
    usePresharedKey: CONFIG.usePresharedKey,
  });

  console.log('═══════════════════════════════════════════');
  console.log('📋 CLÁVES GENERADAS (GUARDAR DE FORMA SEGURA)');
  console.log('═══════════════════════════════════════════\n');
  console.log('CLIENTE PrivateKey:', setup.clientKeys.privateKey);
  console.log('CLIENTE PublicKey: ', setup.clientKeys.publicKey);
  if (setup.presharedKey) {
    console.log('PresharedKey:      ', setup.presharedKey);
  }
  console.log();

  console.log('═══════════════════════════════════════════');
  console.log('📝 COMANDOS PARA EL ROUTER (copiar y pegar en terminal)');
  console.log('═══════════════════════════════════════════\n');
  setup.routerCommands.forEach((cmd, i) => {
    console.log(`${i + 1}. ${cmd}`);
  });
  console.log();

  console.log('═══════════════════════════════════════════');
  console.log('⚙️  CONFIGURACIÓN CLIENTE (para usar en código)');
  console.log('═══════════════════════════════════════════\n');

  // El cliente necesita la clave pública del router (se obtiene tras paso 5 en router)
  console.log('// Después de configurar el router, obtén su clave pública con:');
  console.log('// /interface/wireguard/print show-keys');
  console.log('// Luego reemplaza ROUTER_PUBLIC_KEY_PLACEHOLDER:\n');

  const clientConfig = createClientConfig(
    setup.clientKeys,
    'ROUTER_PUBLIC_KEY_PLACEHOLDER', // ← REEMPLAZAR con clave real del router
    `${CONFIG.routerPublicIP}:${CONFIG.routerWGPort}`,
    CONFIG.clientTunnelIP,
    '10.8.0.1',
    ['10.8.0.1/32'],
    CONFIG.persistentKeepalive,
    setup.presharedKey
  );

  console.log('const clientConfig =', JSON.stringify(clientConfig, null, 2));

  return { setup, clientConfig };
}

// ============================================================================
//  PASO 2: Usar en tu aplicación (configuración final)
// ============================================================================
async function buildClientCredentials(routerPublicKey: string): Promise<RouterCreds> {
  const clientKeys = await generateWireGuardKeys(); // En producción, usa las claves guardadas del Paso 1
  const presharedKey = CONFIG.usePresharedKey ? generatePresharedKey() : undefined;

  const clientConfig: WireGuardConfig = createClientConfig(
    clientKeys,
    routerPublicKey,
    `${CONFIG.routerPublicIP}:${CONFIG.routerWGPort}`,
    CONFIG.clientTunnelIP,
    '10.8.0.1',
    ['10.8.0.1/32'],
    CONFIG.persistentKeepalive,
    presharedKey
  );

  return {
    host: CONFIG.routerPublicIP, // Se ignora si usa WireGuard
    user: CONFIG.routerUser,
    password: CONFIG.routerPassword,
    wireguard: {
      config: clientConfig,
      routerTunnelIP: '10.8.0.1',
      interfaceName: CONFIG.interfaceName,
      preferSystemWG: true, // true = usa wireguard-tools del sistema (kernel), false = userspace
    },
  };
}

// ============================================================================
//  PASO 3: Ejemplo de uso completo
// ============================================================================
async function runExample() {
  // ⚠️ IMPORTANTE: Reemplaza con la clave pública REAL del router
  // Obténla ejecutando en el router: /interface/wireguard/print show-keys
  const ROUTER_PUBLIC_KEY = 'REEMPLAZA_CON_CLAVE_PUBLICA_REAL_DEL_ROUTER';

  if (ROUTER_PUBLIC_KEY === 'REEMPLAZA_CON_CLAVE_PUBLICA_REAL_DEL_ROUTER') {
    console.log('❌ ERROR: Debes configurar ROUTER_PUBLIC_KEY con la clave real del router');
    console.log('   Ejecuta en el router: /interface/wireguard/print show-keys');
    return;
  }

  const creds = await buildClientCredentials(ROUTER_PUBLIC_KEY);

  console.log('🔌 Conectando al router via WireGuard...\n');

  try {
    // Test de conexión
    const test = await testRouterConnection(creds);
    console.log('✅ Test de conexión:', test);

    if (!test.ok) {
      console.log('❌ No se pudo conectar:', test.message);
      return;
    }

    console.log('\n📡 Ejemplos de uso:\n');

    // 1. Ver sesiones PPPoE activas
    console.log('--- Sesiones PPPoE activas ---');
    const pppResult = await runRouterTool(creds, 'ppp-active', 'MiRouter');
    console.log(pppResult.text);
    console.log();

    // 2. Ver recursos del sistema
    console.log('--- Recursos del sistema ---');
    const resourceResult = await runRouterTool(creds, 'resource', 'MiRouter');
    console.log(resourceResult.text);
    console.log();

    // 3. Ver identidad del router
    console.log('--- Identidad del router ---');
    const identityResult = await runRouterTool(creds, 'identity', 'MiRouter');
    console.log(identityResult.text);
    console.log();

    // 4. Ejemplo: Deshabilitar un cliente PPPoE (corte de servicio)
    console.log('--- Deshabilitar cliente PPPoE (ejemplo) ---');
    const disableResult = await setPppoeEnabled(creds, 'cliente_ejemplo', false);
    console.log(disableResult.message);

  } catch (error: any) {
    console.error('❌ Error:', error.message);
  }
}

// ============================================================================
//  EJECUTAR
// ============================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.includes('--generate') || args.includes('-g')) {
    await generateSetup();
  } else {
    await runExample();
  }
}

main().catch(console.error);