#!/bin/bash
INST=ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja
CMD="$1"
for i in $(seq 1 40); do
  J=$(oci instance-agent command-execution get --instance-id "$INST" --command-id "$CMD" --output json 2>&1)
  echo "$J" | python3 -c '
import sys,json,base64
try:
    d=json.load(sys.stdin)["data"]
except Exception as e:
    print("parse-err",e); sys.exit()
print("poll:", d.get("lifecycle-state"), d.get("delivery-state"))
o=((d.get("content") or {}).get("output") or {})
t=o.get("text")
if t:
    print("=== OUTPUT ===")
    print(base64.b64decode(t).decode(errors="replace"))
    sys.exit(7)
if d.get("lifecycle-state") in ("FAILED","TIMED_OUT","CANCELED"):
    print("=== FULL ===", json.dumps(d)[:800])
    sys.exit(7)
' 2>&1
  if [ $? -eq 7 ]; then break; fi
  sleep 15
done
