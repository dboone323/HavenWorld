#!/usr/bin/env python3
import json, subprocess, sys, time
script = """ls ~opc/.ssh/authorized_keys ~havenworld/.ssh/authorized_keys 2>&1
echo '---OPC---'
cat ~opc/.ssh/authorized_keys 2>&1
echo '---HAVEN---'
cat ~havenworld/.ssh/authorized_keys 2>&1
echo '---GUEST-AGENT-KEYS---'
ls /home/*/.ssh/authorized_keys 2>&1
echo '---OCI-AGENT---'
ls /var/lib/oracle-cloud-agent/ 2>&1
cat /var/lib/oracle-cloud-agent/plugins/oci-hpc/*.json 2>/dev/null | head -20 || true
echo '---IMDS-KEYS---'
curl -s -m 10 http://169.254.169.254/opc/v2/instance/metadata/ssh_authorized_keys 2>&1 | head -5
echo '---DONE'"""
payload = {"displayName":"key-hunt","content":{"source":{"sourceType":"TEXT","text":script}},"target":{"instanceId":"ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},"compartmentId":"ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq","timeoutInSeconds":60}
open('/Users/danielstevens/keyhunt.json','w').write(json.dumps(payload))
r=subprocess.run(["oci","instance-agent","command","create","--from-json","file:///Users/danielstevens/keyhunt.json"],capture_output=True,text=True,timeout=60)
if r.returncode!=0: print("ERR:",r.stderr or r.stdout); sys.exit(1)
cid=json.loads(r.stdout)['data']['id']; print("CMD:",cid)
inst="ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
for i in range(40):
    r=subprocess.run(["oci","instance-agent","command-execution","get","--command-id",cid,"--instance-id",inst],capture_output=True,text=True,timeout=30)
    if r.returncode==0:
        c=json.loads(r.stdout).get('data',{}).get('content',{});
        t=c.get('text','') if isinstance(c,dict) else ''
        if t: print(t[:4000]); break
    time.sleep(5)
