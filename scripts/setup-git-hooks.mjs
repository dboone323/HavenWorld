import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const hooksDir = path.join(repoRoot, '.git', 'hooks');

if (fs.existsSync(hooksDir)) {
  const prePushTarget = path.join(hooksDir, 'pre-push');
  const hookScript = `#!/usr/bin/env bash
# Local CI pre-push gate
set -euo pipefail

if [ "\${PUSH_CI_SKIP:-0}" = "1" ]; then
  echo "local-ci: PUSH_CI_SKIP=1 — skipping pre-push gate" >&2
  exit 0
fi

# Run via developer central runner if present
if [ -x "$HOME/Developer/ci/pre-push" ]; then
  exec "$HOME/Developer/ci/pre-push" "$@"
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

echo "==> Running local CI pre-push gate via Docker (make ci-docker)..." >&2
make ci-docker
`;

  if (!fs.existsSync(prePushTarget)) {
    fs.writeFileSync(prePushTarget, hookScript, { mode: 0o755 });
    console.log('[hooks] Installed .git/hooks/pre-push');
  } else {
    try {
      fs.chmodSync(prePushTarget, 0o755);
    } catch {
      // ignore
    }
  }
}
