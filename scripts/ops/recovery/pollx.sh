ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
STATE="$ROOT/logs/local/recovery-json"
mkdir -p "$STATE"
INST=ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja
CMD="$1"
for i in $(seq 1 60); do
  timeout 60 oci instance-agent command-execution get --instance-id $INST --command-id $CMD --output json > "$STATE/execx.json" 2>&1
  S=$(python3 -c "import json;print(json.load(open('$STATE/execx.json'))['data']['lifecycle-state'])" 2>/dev/null)
  echo "$(date +%H:%M:%S) state=$S"
  if [ "$S" = SUCCEEDED ] || [ "$S" = FAILED ]; then python3 -c "import json;d=json.load(open('$STATE/execx.json'))['data'];print('=== OUTPUT ===');print((d.get('content') or {}).get('text') or '(no text)')"; break; fi
  sleep 20
done
