#!/usr/bin/env python3
import json, subprocess, sys, time
# ocarun runs cloud-init scripts? No. But it CAN query IMDSv2 and trigger oci-agent helpers.
# Test: IMDSv2 token + metadata keys endpoint, and check for authorized_keys rewrite tooling.
script = """echo '=TOKEN'; T=$(curl -s -m 10 -X PUT -H 'Authorization: Bearer Oracle' http://169.254.169.254/opc/v2/identity/getBearerTokenForCurrentInstance 2>&1 | head -c 200); echo "$T" | head -c 200; echo
echo '=IMDS-KEYS-V2'; curl -s -m 10 http://169.254.169.254/opc/v2/instance/metadata/ssh_authorized_keys 2>&1 | head -c 500; echo
echo '=AGENT-BIN'; ls /usr/lib/oracle-cloud-agent/plugins/ 2>&1; ls /var/lib/oracle-cloud-agent/plugins/ 2>&1
echo '=DONE'"""
payload = {"displayName":"imds-check","content":{"source":{"sourceType":"TEXT","text":script}},"target":{"instanceId":"ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},"compartmentId":"ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq","timeoutInSeconds":60}
open('/Users/danielstevens/imds.json','w').write(json.dumps(payload))
r=subprocess.run(["oci","instance-agent","command","create","--from-json","file:///Users/danielstevens/imds.json"],capture_output=True,text=True,timeout=60)
if r.returncode!=0: print("ERR:",r.stderr or r.stdout); sys.exit(1)
cid=json.loads(r.stdout)['data']['id']; print("CMD:",cid)
inst="ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
for i in range(40):
    r=subprocess.run(["oci","instance-agent","command-execution","get","--command-id",cid,"--instance-id",inst],capture_output=True,text=True,timeout=30)
    if r.returncode==0:
        c=json.loads(r.stdout).get('data',{}).get('content',{});
        t=c.get('text','') if isinstance(c,dict) else ''
        if t: print(t[:3000]); break
    time.sleep(5)
