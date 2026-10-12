#!/bin/bash
BASTION_ID="ocid1.bastion.oc1.us-chicago-1.amaaaaaamwdgjgaarh7nn4mxykk72b3j3dt2a3geudmh2zr5hpgqsmzag5ha"
INST_ID="ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"

TARGET_JSON='{"sessionType":"MANAGED_SSH","targetResourceId":"'"$INST_ID"'","targetResourceOperatingSystemUserName":"ubuntu","targetResourcePort":2222,"targetResourcePrivateIpAddress":"10.0.0.111"}'

echo "Creating bastion session with ephemeral key..."
oci bastion session create \
  --bastion-id "$BASTION_ID" \
  --display-name "ephemeral-key-$(date +%s)" \
  --key-type EPM \
  --target-resource-details "$TARGET_JSON" \
  --output json > /Users/danielstevens/bastion_epm.json 2>&1

echo "Exit: $?"
python3 << 'PYEOF'
import json, os
d=json.load(open('/Users/danielstevens/bastion_epm.json'))
s=d['data']
print('session-id:', s['id'])
print('state:', s['lifecycle-state'])
pk = s.get('ssh-private-key', '')
if pk:
    path='/Users/danielstevens/.ssh/bastion_ephemeral'
    with open(path, 'w') as f:
        f.write(pk)
    os.chmod(path, 0o600)
    print('Private key saved to:', path)
else:
    print("No private key in response (may appear when ACTIVE)")
    print("All keys:", list(s.keys()))
PYEOF