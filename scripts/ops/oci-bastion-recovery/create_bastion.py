#!/usr/bin/env python3
import json, subprocess, sys, time, os

INST_ID = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
TENANCY = "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq"

# Step 1: Get private IP via Run Command using plain text script
print("=== Getting private IP via Run Command ===")
script = """hostname -I"""

payload = {
    "displayName": "get-ip-v2",
    "content": {"source": {"sourceType": "TEXT", "text": script}},
    "target": {"instanceId": INST_ID},
    "compartmentId": TENANCY,
    "timeoutInSeconds": 60
}

with open('/Users/danielstevens/get_ip_v2.json', 'w') as f:
    json.dump(payload, f)

result = subprocess.run(
    ["oci", "instance-agent", "command", "create", "--from-json", "file:///Users/danielstevens/get_ip_v2.json"],
    capture_output=True, text=True, timeout=60
)
if result.returncode != 0:
    print("ERROR creating command:", result.stderr)
    sys.exit(1)

data = json.loads(result.stdout)
cmd_id = data['data']['id']
print(f"Command ID: {cmd_id}")

# Poll for output
for i in range(30):
    result = subprocess.run(
        ["oci", "instance-agent", "command-execution", "get", "--command-id", cmd_id, "--instance-id", INST_ID],
        capture_output=True, text=True, timeout=30
    )
    if result.returncode == 0:
        d = json.loads(result.stdout)
        content = d.get('data', {}).get('content', {})
        text = content.get('text', '') if isinstance(content, dict) else ''
        if text:
            print(f"Private IP output: {text.strip()}")
            private_ip = text.strip().split()[0]
            break
    time.sleep(5)
else:
    private_ip = "10.0.0.111"  # fallback from earlier output

print(f"Private IP: {private_ip}")

# Step 2: Create bastion session targeting port 2222
print("\n=== Creating bastion session (port 2222) ===")
public_key = open(os.path.expanduser("~/.ssh/oracle_arm.pub")).read().strip()

target_details = {
    "sessionType": "MANAGED_SSH",
    "targetResourceId": INST_ID,
    "targetResourceOperatingSystemUserName": "ubuntu",
    "targetResourcePort": 2222,
    "targetResourcePrivateIpAddress": private_ip
}

payload2 = {
    "displayName": f"fix-ssh-{int(time.time())}",
    "sessionId": "unused",
    "bastionId": "ocid1.bastion.oc1.us-chicago-1.amaaaaaamwdgjgaauyspvgy6huq3boc3x5oxacps6t7bbxofbl2zowjsqcnq",
    "keyType": "PUB",
    "sshPublicKey": public_key,
    "targetResourceDetails": target_details,
    "username": "ubuntu"
}

# Save payload for reference
with open('/Users/danielstevens/bastion_session_payload.json', 'w') as f:
    json.dump(payload2, f, indent=2)

# Create using individual parameters
target_json = json.dumps(target_details)

result = subprocess.run([
    "oci", "bastion", "session", "create",
    "--bastion-id", "ocid1.bastion.oc1.us-chicago-1.amaaaaaamwdgjgaauyspvgy6huq3boc3x5oxacps6t7bbxofbl2zowjsqcnq",
    "--key-type", "PUB",
    "--ssh-public-key", public_key,
    "--target-resource-details", target_json,
    "--display-name", f"fix-ssh-{int(time.time())}",
    "--output", "json"
], capture_output=True, text=True, timeout=60)

print(f"Session create exit: {result.returncode}")
if result.returncode == 0:
    data = json.loads(result.stdout)
    session = data.get('data', {})
    print(f"Session ID: {session.get('id', '?')}")
    print(f"State: {session.get('lifecycle-state', '?')}")
    # Save session ID for SSH connection
    with open('/Users/danielstevens/bastion_session_id.txt', 'w') as f:
        f.write(session.get('id', ''))
    with open('/Users/danielstevens/bastion_private_key', 'w') as f:
        f.write(session.get('ssh-private-key', ''))
    os.chmod('/Users/danielstevens/bastion_private_key', 0o600)
else:
    print("ERROR:", result.stderr or result.stdout)
    # Try with from-json
    print("\n=== Trying from-json approach ===")
    full_payload = {
        "displayName": "fix-ssh",
        "bastionId": "ocid1.bastion.oc1.us-chicago-1.amaaaaaamwdgjgaauyspvgy6huq3boc3x5oxacps6t7bbxofbl2zowjsqcnq",
        "keyType": "PUB",
        "sshPublicKey": public_key,
        "targetResourceDetails": target_details
    }
    with open('/Users/danielstevens/bastion_full.json', 'w') as f:
        json.dump(full_payload, f)
    result2 = subprocess.run(
        ["oci", "bastion", "session", "create", "--from-json", "file:///Users/danielstevens/bastion_full.json"],
        capture_output=True, text=True, timeout=60
    )
    print(f"from-json exit: {result2.returncode}")
    print(f"stdout: {result2.stdout[:500]}")
    print(f"stderr: {result2.stderr[:500]}")
