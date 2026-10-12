#!/usr/bin/env python3
import json, subprocess, sys, time
script = """echo '=SHADOW'; grep -E '^(ubuntu|opc|havenworld):' /etc/shadow 2>&1
echo '=GROUPS-DETAIL'; getent group sudo adm 2>&1
echo '=LASTLOG'; lastlog -u ubuntu -u opc -u havenworld 2>&1
echo '=CLOUD-CFG'; grep -r 'lock_passwd\\|ssh_pwauth\\|disable_root' /etc/cloud/cloud.cfg /etc/cloud/cloud.cfg.d/ 2>&1
echo '=DONE'"""
payload = {"displayName":"shadow-check","content":{"source":{"sourceType":"TEXT","text":script}},"target":{"instanceId":"ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},"compartmentId":"ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq","timeoutInSeconds":60}
open('/Users/danielstevens/shadow.json','w').write(json.dumps(payload))
r=subprocess.run(["oci","instance-agent","command","create","--from-json","file:///Users/danielstevens/shadow.json"],capture_output=True,text=True,timeout=60)
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
