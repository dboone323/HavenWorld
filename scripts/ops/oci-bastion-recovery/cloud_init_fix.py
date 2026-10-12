#!/usr/bin/env python3
import json, base64, subprocess, sys

INST_ID = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
TENANCY = "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq"

# Base64-encoded cloud-init script that fixes iptables and sshd
cloud_init = """#cloud-config
runcmd:
  - /sbin/iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT
  - /sbin/iptables -I INPUT 1 -p tcp --dport 2222 -j ACCEPT
  - mkdir -p /etc/iptables && /sbin/iptables-save > /etc/iptables/rules.v4
  - /usr/sbin/netfilter-persistent save || true
  - grep -q '^Port 22' /etc/ssh/sshd_config || echo 'Port 22' >> /etc/ssh/sshd_config
  - grep -q '^Port 2222' /etc/ssh/sshd_config || echo 'Port 2222' >> /etc/ssh/sshd_config
  - systemctl restart ssh || systemctl restart sshd
"""

user_data_b64 = base64.b64encode(cloud_init.encode()).decode()

# Preserve existing metadata and add user_data
existing_meta = {"ssh_authorized_keys": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF4S1PBUth+UBRXeEV24xfMJdT0k38YOQCZBb+8h7FVE oracle-vm"}

new_meta = {"ssh_authorized_keys": existing_meta["ssh_authorized_keys"], "user_data": user_data_b64}

# Write metadata JSON for CLI
meta_path = '/Users/danielstevens/new_metadata.json'
with open(meta_path, 'w') as f:
    json.dump(new_meta, f)

print(f"cloud-init user_data (base64):\n{user_data_b64[:80]}...")
print(f"\nNew metadata: {json.dumps(new_meta, indent=2)}")

# Update instance metadata (must use --force for the interactive prompt, and preserve agent-config)
AGENT_CONFIG = '[{"name": "Bastion", "desired-state": "ENABLED"}, {"name": "Vulnerability Scanning", "desired-state": "ENABLED"}, {"name": "Custom Logs Monitoring", "desired-state": "ENABLED"}, {"name": "Compute Instance Monitoring", "desired-state": "ENABLED"}, {"name": "Cloud Guard Workload Protection", "desired-state": "ENABLED"}]'
AGENT_CFG_PATH = '/Users/danielstevens/agent_config_updated.json'
with open(AGENT_CFG_PATH, 'w') as f:
    json.dump({
        "is-monitoring-disabled": False,
        "are-all-plugins-disabled": False,
        "plugins-config": [
            {"name": "Bastion", "desired-state": "ENABLED"},
            {"name": "Vulnerability Scanning", "desired-state": "ENABLED"},
            {"name": "Custom Logs Monitoring", "desired-state": "ENABLED"},
            {"name": "Compute Instance Monitoring", "desired-state": "ENABLED"},
            {"name": "Cloud Guard Workload Protection", "desired-state": "ENABLED"}
        ]
    }, f, indent=2)

cmd = [
    "oci", "compute", "instance", "update",
    "--instance-id", INST_ID,
    "--metadata", f"file://{meta_path}",
    "--agent-config", f"file://{AGENT_CFG_PATH}",
    "--force"
]
print(f"\n=== Running: oci compute instance update ===")
result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
print(f"Exit code: {result.returncode}")
if result.returncode == 0:
    data = json.loads(result.stdout)
    print(f"Instance updated. agent-config: {json.dumps(data['data'].get('agent-config',{}), indent=2)}")
    print(f"metadata: {json.dumps(data['data'].get('metadata',{}), indent=2)[:200]}")
else:
    print(f"ERROR: {result.stderr or result.stdout}")
