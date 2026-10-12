#!/usr/bin/env python3
import json, subprocess, sys, time

# Check if we can fix this via Run Command as ocarun using sudo
# Also check the exact sshd_config.d directory
script = """echo '=SSHD_D_DIR'
ls -la /etc/ssh/sshd_config.d/ 2>&1
cat /etc/ssh/sshd_config.d/*.conf 2>&1
echo '=SSHD_RUNNING'
ps aux | grep '[s]shd' 2>&1
echo '=PORT_CHECK'
ss -tlnp 2>&1 | grep -E '22|80|443'
echo '=CLOUD_INIT'
tail -60 /var/log/cloud-init-output.log 2>&1
echo '=SUDO_CHECK'
sudo -n true 2>&1 && echo 'SUDO_OK' || echo 'SUDO_NEEDS_PASSWORD'
echo '=WHICH'
which sshd iptables 2>&1
echo '=DONE'
"""

payload = {
    "displayName": "check-config",
    "content": {"source": {"sourceType": "TEXT", "text": script}},
    "target": {"instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "timeoutInSeconds": 60
}

with open('/Users/danielstevens/config_check.json', 'w') as f:
    json.dump(payload, f, indent=2)

result = subprocess.run(
    ["oci", "instance-agent", "command", "create", "--from-json", "file:///Users/danielstevens/config_check.json"],
    capture_output=True, text=True, timeout=60
)
if result.returncode != 0:
    print("ERROR:", result.stderr)
    sys.exit(1)

data = json.loads(result.stdout)
cmd_id = data['data']['id']
print(f"Command ID: {cmd_id}")

INST_ID = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
for i in range(60):
    result = subprocess.run(
        ["oci", "instance-agent", "command-execution", "get",
         "--command-id", cmd_id, "--instance-id", INST_ID],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        d = json.loads(result.stdout)
        content = d.get('data', {}).get('content', {})
        text = content.get('text', '') if isinstance(content, dict) else ''
        if text:
            print("=== OUTPUT ===")
            print(text[:6000])
            break
    time.sleep(5)
else:
    print("Timed out")
