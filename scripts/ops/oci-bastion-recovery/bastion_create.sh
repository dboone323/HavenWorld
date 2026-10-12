#!/bin/bash
BASTION_ID="ocid1.bastion.oc1.us-chicago-1.amaaaaaamwdgjgaarh7nn4mxykk72b3j3dt2a3geudmh2zr5hpgqsmzag5ha"
INST_ID="ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"

TARGET_JSON='{"sessionType":"MANAGED_SSH","targetResourceId":"'"$INST_ID"'","targetResourceOperatingSystemUserName":"ubuntu","targetResourcePort":2222,"targetResourcePrivateIpAddress":"10.0.0.111"}'

oci bastion session create \
  --bastion-id "$BASTION_ID" \
  --display-name "ssh-fix-$(date +%s)" \
  --key-type PUB \
  --target-resource-details "$TARGET_JSON" \
  --output json > /Users/danielstevens/bastion_final.json 2>&1

echo "Exit: $?"
cat /Users/danielstevens/bastion_final.json | python3 -c "
import sys,json
d=json.load(sys.stdin)
s=d['data']
print('session-id:', s['id'])
print('state:', s['lifecycle-state'])
"