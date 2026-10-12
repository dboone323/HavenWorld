#!/usr/bin/env python3
import json, subprocess, sys, time

script = """echo '=IPT_RULES_FILE'
cat /etc/iptables/rules.v4 2>&1 || echo '(no rules.v4 file)'
echo '=UFW_USER_RULES'
cat /etc/ufw/user.rules 2>&1 | tail -50
echo '=UFW_STATUS'
ufw status verbose 2>&1 || echo 'ufw not available'
echo '=NFT_CHECK'
nft list ruleset 2>&1 | head -40
echo '=IPT_CHECK'
iptables -S 2>&1
echo '=SSHD_CFG_FULL'
cat /etc/ssh/sshd_config 2>&1 | grep -vE '^#|^$'
echo '=SSHD_DROPINS'
cat /etc/ssh/sshd_config.d/*.conf 2>&1
echo '=DONE'
"""

payload = {
    "displayName": "check-firewall",
    "content": {"source": {"sourceType": "TEXT", "text": script}},
    "target": {"instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "timeoutInSeconds": 60
}

with open('/Users/danielstevens/fw_check.json', 'w') as f:
    json.dump(payload, f, indent=2)

result = subprocess.run(
    ["oci", "instance-agent", "command", "create", "--from-json", "file:///Users/danielstevens/fw_check.json"],
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
