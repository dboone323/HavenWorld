// apps/client/scripts/copy-havok.cjs
// Copies HavokPhysics.wasm from @babylonjs/havok into public/ at build time.
// Uses CommonJS (require) so it works regardless of the package "type": "module".
'use strict';

const fs   = require('fs');
const path = require('path');

try {
  const pkg   = require.resolve('@babylonjs/havok/package.json');
  const dir   = path.dirname(pkg);
  const src   = path.join(dir, 'lib', 'esm', 'HavokPhysics.wasm');
  const dest  = path.join(__dirname, '..', 'public', 'HavokPhysics.wasm');

  if (fs.existsSync(src)) {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
    console.log('[copy-havok] Copied HavokPhysics.wasm →', dest);
  } else {
    console.warn('[copy-havok] Source not found at', src, '— skipping');
  }
} catch (err) {
  // Non-fatal: wasm may already be in public/ or not required in this env
  console.warn('[copy-havok] Could not copy HavokPhysics.wasm:', err.message);
}
