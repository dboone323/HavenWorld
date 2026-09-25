#!/bin/bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE="$ROOT/logs/local/recovery-json"
mkdir -p "$STATE"
T=ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq
CONTENT="$1"; NAME="$2"
CMD=$(oci instance-agent command create --compartment-id "$T" \
  --target "file://$STATE/rc_target.json" --content "file://$CONTENT" \
  --timeout-in-seconds 240 --display-name "$NAME" --query data.id --raw-output 2>&1)
echo "CMD=$CMD"
case "$CMD" in ocid1.*) ;; *) echo "CREATE_FAILED"; exit 1 ;; esac
bash "$(dirname "${BASH_SOURCE[0]}")/poll.sh" "$CMD"
