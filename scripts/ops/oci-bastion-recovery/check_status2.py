#!/usr/bin/env python3
import json, subprocess, sys, time

# Script as plain text (not base64)
script = """echo '=ID'; id
echo '=DATE'; date
echo '=LISTEN'; ss -tlnp 2>&1
echo '=SSHD_PROC'; ps aux | grep '[s]sh' 2>&1
echo '=SOCKETS'; systemctl list-sockets 2>&1 | grep ssh || true
echo '=IPT_CHECK'; iptables -S 2>&1
echo '=NFT_CHECK'; nft list ruleset 2>&1 | head -20
echo '=REJECT'; grep -r '2222' /etc/iptables/ 2>&1 || echo 'no iptables config'
echo '=SSHD_CFG'; grep -rn -E 'Port|Allow|Permit|Listen' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>&1
echo '=CLOUD_INIT'; tail -30 /var/log/cloud-init-output.log 2>&1
echo '=FAIL2BAN'; grep -r '2222' /etc/fail2ban/ 2>&1 || echo 'no fail2ban refs'
echo '=DONE'
"""

payload = {
    "displayName": "status-check2",
    "content": {
        "source": {
            "sourceType": "TEXT",
            "text": script
        }
    },
    "target": {
        "instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
    },
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "timeoutInSeconds": 60
}

payload_path = '/Users/danielstevens/status2.json'
with open(payload_path, 'w') as f:
    json.dump(payload, f, indent=2)

cmd = ["oci", "instance-agent", "command", "create", "--from-json", f"file://{payload_path}"]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
if result.returncode != 0:
    print("ERROR:", result.stderr or result.stdout)
    sys.exit(1)

data = json.loads(result.stdout)
cmd_id = data['data']['id']
print(f"Command ID: {cmd_id}")

INST_ID = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
for i in range(60):
    result = subprocess.run(
        ["oci", "instance-agent", "command-execution", "get",
         "--command-id", cmd_id,
         "--instance-id", INST_ID],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        d = json.loads(result.stdout)
        content = d.get('data', {}).get('content', {})
        text = content.get('text', '') if isinstance(content, dict) else ''
        if text:
            print("=== OUTPUT ===")
            print(text[:4000])
            break
    time.sleep(5)
else:
    print("Timed out waiting for output")
