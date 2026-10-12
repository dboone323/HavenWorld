#!/usr/bin/env python3
import json, subprocess, sys, time

# Script to fix iptables and sshd
script = """echo '=ID'; id
echo '=IPT_BEFORE'; iptables -S INPUT 2>&1
# Allow port 2222 in iptables
iptables -I INPUT 1 -p tcp --dport 2222 -j ACCEPT 2>&1
echo '=IPT_AFTER'; iptables -S INPUT 2>&1
# Save iptables rules
mkdir -p /etc/iptables; iptables-save > /etc/iptables/rules.v4 2>&1
netfilter-persistent save 2>&1
echo '=LISTEN'; ss -tlnp 2>&1
# Also add port 22 back to sshd_config as backup
grep -q '^Port 22' /etc/ssh/sshd_config || echo 'Port 22' >> /etc/ssh/sshd_config
grep -q '^Port 2222' /etc/ssh/sshd_config || echo 'Port 2222' >> /etc/ssh/sshd_config
# Restart ssh to pick up both ports
systemctl restart ssh 2>&1 || systemctl restart sshd 2>&1
echo '=LISTEN_AFTER'; ss -tlnp 2>&1
echo '=SVC'; systemctl is-active ssh 2>&1
echo '=DONE'
"""

payload = {
    "displayName": "fix-ssh-firewall",
    "compartmentId": "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq",
    "content": {
        "source": {
            "sourceType": "TEXT",
            "text": script
        }
    },
    "target": {
        "instanceId": "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
    },
    "timeoutInSeconds": 300
}

payload_path = '/Users/danielstevens/fix_ssh_payload2.json'
with open(payload_path, 'w') as f:
    json.dump(payload, f, indent=2)

cmd = ["oci", "instance-agent", "command", "create", "--from-json", f"file://{payload_path}"]
result = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
if result.returncode != 0:
    print("ERROR creating command:", result.stderr or result.stdout)
    sys.exit(1)

data = json.loads(result.stdout)
command_id = data['data']['id']
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
