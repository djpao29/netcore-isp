// ============================================================================
//  Generador del runtime PHP a partir de la fuente única de verdad
//  (shared/modules.ts). Emite app/Generated/modules.json con el árbol de
//  módulos (grupos, columnas, campos, defaults e integración) para que el
//  backend PHP + MySQL en XAMPP/cPanel reproduzca el mismo CRUD genérico.
//
//  Uso:  npm run generate:php
// ============================================================================
import fs from 'fs';
import path from 'path';
import { GROUP_ORDER, MODULE_REGISTRY } from '../shared/modules';

function main() {
  const outDir = path.join(process.cwd(), 'app', 'Generated');
  fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    generated_at: new Date().toISOString(),
    source: 'shared/modules.ts',
    notice:
      'Archivo generado automáticamente. No editar a mano: ejecuta "npm run generate:php" tras cambiar shared/modules.ts.',
    groups: GROUP_ORDER,
    modules: MODULE_REGISTRY,
  };

  const file = path.join(outDir, 'modules.json');
  fs.writeFileSync(file, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(`✓ ${payload.modules.length} módulos exportados a app/Generated/modules.json`);
}

main();
