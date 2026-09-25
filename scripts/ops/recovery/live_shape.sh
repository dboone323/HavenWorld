#!/bin/bash
set -euo pipefail
IP="$1"
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DST="/opt/havenworld/tmp/shape"
ssh -i ~/.ssh/oci_ai_agent_runner -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  ubuntu@"$IP" "mkdir -p '$DST' && chmod 700 '$DST'"
scp -i ~/.ssh/oci_ai_agent_runner -o IdentitiesOnly=yes "$SRC/scripts/ops/LiveDBShape.js" ubuntu@"$IP":"$DST"/live_shape.js
ssh -i ~/.ssh/oci_ai_agent_runner -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new \
  ubuntu@"$IP" "cd '$DST' && \
   set -a && source /opt/havenworld/apps/server/.env && set +a && \
   sudo -u havenworld NODE_PATH=/opt/havenworld/node_modules \
   DATABASE_URL=\"\$DATABASE_URL\" node live_shape.js 2>&1"
