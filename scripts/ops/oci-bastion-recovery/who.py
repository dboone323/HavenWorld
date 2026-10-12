#!/usr/bin/env python3
import json, subprocess, sys, time
script = """echo '=WHO'; ls /home/ 2>&1
echo '=PASSWD'; grep -E 'ubuntu|admin|opc|oracle' /etc/passwd 2>&1
echo '=GROUPS'; groups ubuntu 2>&1; id ubuntu 2>&1
echo '=SUDOERS'; ls /etc/sudoers.d/ 2>&1
echo '=KEYS'; ls -la /home/ubuntu/.ssh/ 2>&1; wc -l /home/ubuntu/.ssh/authorized_keys 2>&1
echo '=CLOUD_SSH_KEYS'; cat /var/lib/cloud/instance/authorized_keys 2>&1 | head -5 || cat /var/lib/cloud/instances/*/authorized_keys 2>&1 | head -5 || true
echo '=DONE'"""
payload = {"displayName":"who-check","content":{"source":{"sourceType":"TEXT","text":script}},"target":{"instanceId":"ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},"compartmentId":"ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq","timeoutInSeconds":60}
open('/Users/danielstevens/who.json','w').write(json.dumps(payload))
r=subprocess.run(["oci","instance-agent","command","create","--from-json","file:///Users/danielstevens/who.json"],capture_output=True,text=True,timeout=60)
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
