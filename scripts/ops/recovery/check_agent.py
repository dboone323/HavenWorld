#!/usr/bin/env python3
"""Create and poll an Oracle Cloud Agent Run Command that inspects the agent."""
import base64
import json
import os
import subprocess
import sys
import time

COMPARTMENT_ID = "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq"
INSTANCE_ID = "ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
STATE = os.path.join(ROOT, "logs", "local", "recovery-json")
os.makedirs(STATE, exist_ok=True)

script = (
    "cat /etc/oci-agent/agent.yaml 2>&1; echo '---'; "
    "cat /etc/oci/config/agent-config.yaml 2>&1; echo '---'; "
    "ls /etc/oci/ 2>&1; echo '---'; "
    "systemctl is-active oracle-cloud-agent 2>&1"
)
payload = {
    "displayName": "check-agent",
    "compartmentId": COMPARTMENT_ID,
    "content": {
        "source": {
            "sourceType": "TEXT",
            "text": base64.b64encode(script.encode()).decode(),
            "encoding": "BASE64",
        }
    },
    "target": {"instanceId": INSTANCE_ID},
}
payload_path = os.path.join(STATE, "check-agent.json")
with open(payload_path, "w") as handle:
    json.dump(payload, handle, indent=2)

result = subprocess.run(
    [
        "oci",
        "instance-agent",
        "command",
        "create",
        "--from-json",
        f"file://{payload_path}",
    ],
    capture_output=True,
    text=True,
    timeout=60,
)
if result.returncode != 0:
    print("Error:", result.stderr or result.stdout)
    sys.exit(1)

command_id = json.loads(result.stdout)["data"]["id"]
print("Command ID:", command_id)

for attempt in range(60):
    result = subprocess.run(
        [
            "oci",
            "instance-agent",
            "command-execution",
            "get",
            "--command-id",
            command_id,
            "--instance-id",
            INSTANCE_ID,
            "--output",
            "json",
        ],
        capture_output=True,
        text=True,
        timeout=30,
    )
    if result.returncode == 0:
        data = json.loads(result.stdout)
        content = data.get("data", {}).get("content", {})
        text = content.get("text") if isinstance(content, dict) else None
        if text:
            print(f"=== OUTPUT (poll {attempt + 1}) ===")
            print(text[:3000])
            break
    time.sleep(5)
else:
    print("Timed out")

