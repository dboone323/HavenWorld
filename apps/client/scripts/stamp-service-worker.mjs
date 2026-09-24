import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const clientRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const swPath = path.join(clientRoot, 'dist', 'sw.js');
let revision = 'local';

try {
  revision = execFileSync('git', ['rev-parse', '--short=12', 'HEAD'], {
    cwd: clientRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
} catch {
  // Local/dirty builds still get a unique-enough shell ID without requiring git.
  revision = `local-${Date.now().toString(36)}`;
}

const source = readFileSync(swPath, 'utf8');
const stamped = source.replace(
  /const CACHE_VERSION = '[^']+';/,
  `const CACHE_VERSION = 'havenworld-${revision}';`
);
if (stamped === source) {
  throw new Error(`Could not stamp service-worker cache version in ${swPath}`);
}
writeFileSync(swPath, stamped);
console.log(`[build] service-worker cache stamped as havenworld-${revision}`);
