ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE="$ROOT/logs/local/recovery-json"
mkdir -p "$STATE"
INST=ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja
CMD=ocid1.instanceagentcommand.oc1.us-chicago-1.amaaaaaamwdgjgaa6q6xz6vrxkmwuhc4khlkqzwpj5ged3he24unbcgnyc5a
for i in $(seq 1 60); do
  timeout 60 oci instance-agent command-execution get --instance-id $INST --command-id $CMD --output json > "$STATE/exec4.json" 2>&1
  S=$(python3 -c "import json;print(json.load(open('$STATE/exec4.json'))['data']['lifecycle-state'])" 2>/dev/null)
  echo "$(date +%H:%M:%S) state=$S"
  if [ "$S" = SUCCEEDED ] || [ "$S" = FAILED ]; then python3 -c "import json;d=json.load(open('$STATE/exec4.json'))['data'];print('=== OUTPUT ===');print((d.get('content') or {}).get('text') or '(no text)')"; break; fi
  sleep 20
done
