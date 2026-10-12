#!/usr/bin/env python3
import json, base64, subprocess, sys, time

script = """echo '=DATE'; date
echo '=ID'; id
echo '=LISTEN'; ss -tlnp 2>&1
echo '=IPT'; iptables -S 2>&1
echo '=NFT'; nft list ruleset 2>&1 | head -30
echo '=SSHD_CFG'; grep -rn -E '^[[:space:]]*Port |^[[:space:]]*Allow|PermitRoot|ListenStream' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>&1
echo '=SVC'; systemctl is-active ssh sshd 2>&1
echo '=SOCKET'; systemctl is-active ssh.socket 2>&1
"""

encoded = base64.b64encode(script.encode()).decode()

payload = {
    "displayName": "diag-live",
    "content": {
        "sourceType": "TEXT",
        "text": encoded,
        "encoding": "BASE64"
    },
    "target": {
        "instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
    },
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "runAsUser": "root",
    "executionMode": "STANDARD",
    "timeoutInSeconds": 300
}

payload_path = '/Users/danielstevens/diag_live.json'
with open(payload_path, 'w') as f:
    json.dump(payload, f, indent=2)

cmd = ["oci", "instance-agent", "command", "create", "--from-json", f"file://{payload_path}"]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
if result.returncode != 0:
    print("ERROR creating command:", result.stderr or result.stdout)
    sys.exit(1)

data = json.loads(result.stdout)
command_id = data['data']['instance-agent-command-id']
print(f"Command ID: {command_id}")

# Poll for result
for i in range(60):
    result = subprocess.run(
        ["oci", "instance-agent", "command-execution", "get",
         "--command-id", command_id,
         "--instance-id", "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        data = json.loads(result.stdout)
        content = data.get('data', {}).get('content', {})
        text = content.get('text', '')
        if text:
            print(f"\n=== OUTPUT (poll {i+1}) ===")
            print(text)
            break
    time.sleep(5)
else:
    print("Timed out waiting for output")
