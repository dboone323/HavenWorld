#!/usr/bin/env python3
import json, base64, subprocess, sys, time

# Quick diagnostic script
script = """echo '=ID'; id
echo '=DATE'; date
echo '=LISTEN'; ss -tlnp 2>&1
echo '=SSHD_PROC'; ps aux | grep -E '[s]shd' 2>&1
echo '=SOCKETS'; systemctl list-sockets 2>&1 || socketlist 2>&1 || true
echo '=IPT_CHECK'; ls -la /proc/net/ip_tables_names 2>&1; cat /proc/net/ip_tables_names 2>&1 || true
echo '=NFT_CHECK'; ls -la /proc/net/nf_tables 2>&1
echo '=REJECT_CHECK'; grep -r '2222' /etc/iptables/ 2>&1 || echo 'no iptables config files'
echo '=SSHD_CFG'; grep -rn -E '^[[:space:]]*Port |^[[:space:]]*Allow|Listen' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/ 2>&1
echo '=CLOUD_INIT'; cat /var/log/cloud-init-output.log 2>&1 | tail -30
echo '=DONE'
"""

encoded = base64.b64encode(script.encode()).decode()
payload = {
    "displayName": "status-check",
    "content": {"source": {"sourceType": "TEXT", "text": encoded, "encoding": "BASE64"}},
    "target": {"instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"},
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "timeoutInSeconds": 60
}

with open('/Users/danielstevens/status.json', 'w') as f:
    json.dump(payload, f)

result = subprocess.run(
    ["oci", "instance-agent", "command", "create", "--from-json", "file:///Users/danielstevens/status.json"],
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
        ["oci", "instance-agent", "command-execution", "get", "--command-id", cmd_id, "--instance-id", INST_ID],
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
