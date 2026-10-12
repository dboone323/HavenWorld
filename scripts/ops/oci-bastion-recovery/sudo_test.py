#!/usr/bin/env python3
import json, subprocess, sys, time

script = """echo '=WHOMAI'; id
echo '=SUDO_NOPASSWD_TEST'; sudo -n true 2>&1; echo "exit=$?"
echo '=SUDO_ID'; sudo -n id 2>&1
echo '=SSHD_PORTS'; sudo -n sshd -T 2>&1 | grep -i '^port'
echo '=IPT'; sudo -n iptables -S INPUT 2>&1 | head -25
echo '=DONE'"""

payload = {
    "displayName": "sudo-test",
    "content": {"source": {"sourceType": "TEXT", "text": script}},
    "target": {"instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "timeoutInSeconds": 60
}
with open('/Users/danielstevens/sudo_test.json', 'w') as f:
    json.dump(payload, f, indent=2)

r = subprocess.run(["oci", "instance-agent", "command", "create", "--from-json", "file:///Users/danielstevens/sudo_test.json"], capture_output=True, text=True, timeout=60)
if r.returncode != 0:
    print("CREATE_ERROR:", r.stderr or r.stdout)
    sys.exit(1)
cmd_id = json.loads(r.stdout)['data']['id']
print("Command ID:", cmd_id)

inst = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
for i in range(40):
    r = subprocess.run(["oci", "instance-agent", "command-execution", "get", "--command-id", cmd_id, "--instance-id", inst], capture_output=True, text=True, timeout=30)
    if r.returncode == 0:
        c = json.loads(r.stdout).get('data', {}).get('content', {})
        t = c.get('text', '') if isinstance(c, dict) else ''
        if t:
            print("=== OUTPUT ===")
            print(t[:4000])
            break
    time.sleep(5)
else:
    print("TIMED_OUT")
