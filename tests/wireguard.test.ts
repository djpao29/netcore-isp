// ============================================================================
//  Tests para WireGuard implementation
// ============================================================================
import {
  generateWireGuardKeys,
  derivePublicKey,
  generatePresharedKey,
  createClientConfig,
  createRouterPeerConfig,
  serializeConfig,
  generateWireGuardSetup,
  WireGuardConfig,
  WireGuardKeys,
} from '../wireguard';

// ============================================================================
//  Helpers de test
// ============================================================================
function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(`Assertion failed: ${message}`);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`Assertion failed: ${message} - Expected: ${expected}, Got: ${actual}`);
  }
}

function assertContains(haystack: string, needle: string, message: string) {
  if (!haystack.includes(needle)) {
    throw new Error(`Assertion failed: ${message} - "${needle}" not found in string`);
  }
}

function assertNotNull<T>(value: T | null | undefined, message: string): T {
  if (value === null || value === undefined) {
    throw new Error(`Assertion failed: ${message} - value is null/undefined`);
  }
  return value;
}

// ============================================================================
//  Tests
// ============================================================================

async function testGenerateWireGuardKeys() {
  console.log('🧪 Test: generateWireGuardKeys...');

  const keys1 = await generateWireGuardKeys();
  const keys2 = await generateWireGuardKeys();

  assertNotNull(keys1.privateKey, 'privateKey should exist');
  assertNotNull(keys1.publicKey, 'publicKey should exist');
  assertNotNull(keys2.privateKey, 'privateKey should exist');
  assertNotNull(keys2.publicKey, 'publicKey should exist');

  // Claves deben ser base64 válido
  assert(Buffer.from(keys1.privateKey, 'base64').length === 32, 'privateKey should be 32 bytes');
  assert(Buffer.from(keys1.publicKey, 'base64').length === 32, 'publicKey should be 32 bytes');

  // Claves deben ser diferentes cada vez
  assert(keys1.privateKey !== keys2.privateKey, 'privateKeys should be different');
  assert(keys1.publicKey !== keys2.publicKey, 'publicKeys should be different');

  console.log('  ✅ generateWireGuardKeys passed');
}

async function testDerivePublicKey() {
  console.log('🧪 Test: derivePublicKey...');

  const keys = await generateWireGuardKeys();
  const derived = await derivePublicKey(keys.privateKey);

  assertEqual(derived, keys.publicKey, 'derived publicKey should match original');

  console.log('  ✅ derivePublicKey passed');
}

async function testGeneratePresharedKey() {
  console.log('🧪 Test: generatePresharedKey...');

  const key1 = generatePresharedKey();
  const key2 = generatePresharedKey();

  assertNotNull(key1, 'presharedKey should exist');
  assertNotNull(key2, 'presharedKey should exist');
  assert(Buffer.from(key1, 'base64').length === 32, 'presharedKey should be 32 bytes');
  assert(key1 !== key2, 'presharedKeys should be different');

  console.log('  ✅ generatePresharedKey passed');
}

async function testCreateClientConfig() {
  console.log('🧪 Test: createClientConfig...');

  const clientKeys = await generateWireGuardKeys();
  const routerPublicKey = (await generateWireGuardKeys()).publicKey;

  const config = createClientConfig(
    clientKeys,
    routerPublicKey,
    'router.example.com:51820',
    '10.8.0.2/24',
    '10.8.0.1',
    ['10.8.0.1/32'],
    25,
    'preshared-key-base64'
  );

  assertNotNull(config, 'config should exist');
  assertEqual(config.interface.privateKey, clientKeys.privateKey, 'privateKey should match');
  assertEqual(config.interface.address[0], '10.8.0.2/24', 'address should match');
  assertEqual(config.interface.listenPort, 0, 'listenPort should be 0 (random)');
  assertEqual(config.peers.length, 1, 'should have 1 peer');
  assertEqual(config.peers[0].publicKey, routerPublicKey, 'peer publicKey should match');
  assertEqual(config.peers[0].endpoint, 'router.example.com:51820', 'endpoint should match');
  assertEqual(config.peers[0].allowedIPs[0], '10.8.0.1/32', 'allowedIPs should match');
  assertEqual(config.peers[0].persistentKeepalive, 25, 'persistentKeepalive should match');
  assertEqual(config.peers[0].presharedKey, 'preshared-key-base64', 'presharedKey should match');

  console.log('  ✅ createClientConfig passed');
}

async function testCreateRouterPeerConfig() {
  console.log('🧪 Test: createRouterPeerConfig...');

  const clientPublicKey = (await generateWireGuardKeys()).publicKey;

  const config = createRouterPeerConfig(
    clientPublicKey,
    '10.8.0.2/32',
    ['10.8.0.2/32'],
    25,
    'preshared-key-base64'
  );

  assertNotNull(config, 'config should exist');
  assertEqual(config['public-key'], clientPublicKey, 'public-key should match');
  assertEqual(config['allowed-address'], '10.8.0.2/32', 'allowed-address should match');
  assertEqual(config['persistent-keepalive'], '25', 'persistent-keepalive should match');
  assertEqual(config['preshared-key'], 'preshared-key-base64', 'preshared-key should match');

  console.log('  ✅ createRouterPeerConfig passed');
}

async function testSerializeConfig() {
  console.log('🧪 Test: serializeConfig...');

  const clientKeys = await generateWireGuardKeys();
  const routerPublicKey = (await generateWireGuardKeys()).publicKey;

  const config = createClientConfig(
    clientKeys,
    routerPublicKey,
    'router.example.com:51820',
    '10.8.0.2/24',
    '10.8.0.1',
    ['10.8.0.1/32'],
    25,
    'preshared-key-base64'
  );

  const serialized = serializeConfig(config);

  assertContains(serialized, '[Interface]', 'should have Interface section');
  assertContains(serialized, 'PrivateKey =', 'should have PrivateKey');
  assertContains(serialized, 'Address = 10.8.0.2/24', 'should have Address');
  assertContains(serialized, 'ListenPort = 0', 'should have ListenPort');
  assertContains(serialized, '[Peer]', 'should have Peer section');
  assertContains(serialized, 'PublicKey =', 'should have Peer PublicKey');
  assertContains(serialized, 'Endpoint = router.example.com:51820', 'should have Endpoint');
  assertContains(serialized, 'AllowedIPs = 10.8.0.1/32', 'should have AllowedIPs');
  assertContains(serialized, 'PersistentKeepalive = 25', 'should have PersistentKeepalive');
  assertContains(serialized, 'PresharedKey = preshared-key-base64', 'should have PresharedKey');

  console.log('  ✅ serializeConfig passed');
}

async function testGenerateWireGuardSetup() {
  console.log('🧪 Test: generateWireGuardSetup...');

  const setup = await generateWireGuardSetup({
    routerPublicIP: 'router.example.com',
    routerWGPort: 51820,
    routerTunnelIP: '10.8.0.1/24',
    clientTunnelIP: '10.8.0.2/24',
    allowedIPs: ['10.8.0.1/32'],
    persistentKeepalive: 25,
    usePresharedKey: true,
  });

  assertNotNull(setup, 'setup should exist');
  assertNotNull(setup.clientKeys, 'clientKeys should exist');
  assertNotNull(setup.clientConfig, 'clientConfig should exist');
  assertNotNull(setup.presharedKey, 'presharedKey should exist when usePresharedKey=true');
  assertEqual(setup.routerCommands.length, 6, 'should have 6 router commands');

  // Verificar comandos del router
  assertContains(setup.routerCommands[0], '/interface/wireguard/add', 'should create wireguard interface');
  assertContains(setup.routerCommands[1], '/ip/address/add', 'should add IP address');
  assertContains(setup.routerCommands[2], '/interface/wireguard/peers/add', 'should add peer');
  assertContains(setup.routerCommands[3], '/ip/firewall/filter/add', 'should add firewall rule for API');
  assertContains(setup.routerCommands[4], '/ip/firewall/filter/add', 'should add firewall rule for WireGuard');
  assertContains(setup.routerCommands[5], '/interface/wireguard/print show-keys', 'should show router public key');

  console.log('  ✅ generateWireGuardSetup passed');
}

async function testGenerateWireGuardSetupWithoutPresharedKey() {
  console.log('🧪 Test: generateWireGuardSetup (sin presharedKey)...');

  const setup = await generateWireGuardSetup({
    routerPublicIP: 'router.example.com',
    routerTunnelIP: '10.8.0.1/24',
    clientTunnelIP: '10.8.0.2/24',
    usePresharedKey: false,
  });

  assertNotNull(setup, 'setup should exist');
  assertEqual(setup.presharedKey, undefined, 'presharedKey should be undefined when usePresharedKey=false');

  // El comando del peer no debería tener preshared-key
  assert(!setup.routerCommands[2].includes('preshared-key'), 'peer command should not have preshared-key');

  console.log('  ✅ generateWireGuardSetup (sin presharedKey) passed');
}

async function testConfigRoundtrip() {
  console.log('🧪 Test: Config roundtrip (serialize -> parse)...');

  const clientKeys = await generateWireGuardKeys();
  const routerPublicKey = (await generateWireGuardKeys()).publicKey;

  const config = createClientConfig(
    clientKeys,
    routerPublicKey,
    'router.example.com:51820',
    '10.8.0.2/24',
    '10.8.0.1',
    ['10.8.0.1/32', '192.168.1.0/24'],
    25,
    'preshared-key-base64'
  );

  const serialized = serializeConfig(config);

  // Verificar que se puede parsear de vuelta (básico)
  assertContains(serialized, 'Address = 10.8.0.2/24', 'Address should be in serialized');
  assertContains(serialized, 'AllowedIPs = 10.8.0.1/32, 192.168.1.0/24', 'Multiple AllowedIPs should be comma-separated');

  console.log('  ✅ Config roundtrip passed');
}

async function testKeysAreValidBase64() {
  console.log('🧪 Test: All generated keys are valid base64...');

  const keys = await generateWireGuardKeys();
  const preshared = generatePresharedKey();

  // No debe lanzar excepción
  Buffer.from(keys.privateKey, 'base64');
  Buffer.from(keys.publicKey, 'base64');
  Buffer.from(preshared, 'base64');

  console.log('  ✅ All keys are valid base64 passed');
}

// ============================================================================
//  Ejecutar todos los tests
// ============================================================================
async function runAllTests() {
  console.log('\n═══════════════════════════════════════');
  console.log('   INICIANDO TESTS WIREGUARD');
  console.log('═══════════════════════════════════════\n');

  const tests = [
    testGenerateWireGuardKeys,
    testDerivePublicKey,
    testGeneratePresharedKey,
    testCreateClientConfig,
    testCreateRouterPeerConfig,
    testSerializeConfig,
    testGenerateWireGuardSetup,
    testGenerateWireGuardSetupWithoutPresharedKey,
    testConfigRoundtrip,
    testKeysAreValidBase64,
  ];

  let passed = 0;
  let failed = 0;

  for (const test of tests) {
    try {
      await test();
      passed++;
    } catch (error: any) {
      console.error(`  ❌ FAILED: ${error.message}`);
      failed++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`   RESULTADO: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runAllTests().catch(console.error);