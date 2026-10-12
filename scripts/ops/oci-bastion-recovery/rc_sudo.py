#!/usr/bin/env python3
import json, subprocess, time, sys
INST="ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
TEN="ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq"
script=open(sys.argv[1]).read() if len(sys.argv)>1 else "id; sudo -n true; echo SUDO_EXIT:$?"
payload={"displayName":"sudo-check","content":{"source":{"sourceType":"TEXT","text":script}},"target":{"instanceId":INST},"compartmentId":TEN,"timeoutInSeconds":60}
open("/Users/danielstevens/rc_sudo.json","w").write(json.dumps(payload))
r=subprocess.run(["oci","instance-agent","command","create","--from-json","file:///Users/danielstevens/rc_sudo.json"],capture_output=True,text=True,timeout=60)
print(r.stdout[:500]); print(r.stderr[:500])
cmd=json.loads(r.stdout)["data"]["id"]
print("CMD:",cmd)
for i in range(24):
    time.sleep(5)
    r2=subprocess.run(["oci","instance-agent","command-execution","get","--command-id",cmd,"--instance-id",INST],capture_output=True,text=True,timeout=30)
    try:
        t=json.loads(r2.stdout)["data"].get("content",{}).get("text","")
        if t:
            print(t[:4000]); break
    except Exception as e: print("poll",i,e)
else: print("TIMEOUT")
