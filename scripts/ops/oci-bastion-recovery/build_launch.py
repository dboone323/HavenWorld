#!/usr/bin/env python3
"""Build relaunch JSON using SAME image, subnet, shape as stopped instance.
Instance stays STOPPED. We create a NEW instance from the CURRENT boot volume
(swapped out underneath) -- actually simplest robust path: launch new instance
from image in same subnet, reuse keys. Old instance stays stopped as fallback.
"""
import json, base64

TENANCY = "ocid1.tenancy.oc1..aaaaaaaaknewdg47aijyiytgvtuby3mrpilfzt7xasbaknih7dazfmek2yrq"
AD = "RqiG:US-CHICAGO-1-AD-2"
SUBNET = "ocid1.subnet.oc1.us-chicago-1.aaaaaaaawcjflv2ybbyljx46zdfdlodwkumnj2a6356rrvwatgclrhdxkd5a"
IMAGE = "ocid1.image.oc1.us-chicago-1.aaaaaaaarfvncnx66uvxfcj6s52ghvqnrqjkdk4ik6koxrecvxxghrtswvpa"  # Canonical-Ubuntu-24.04-aarch64-2026.08.25-0 same as current

cloud_init = """#cloud-config
users:
  - name: ubuntu
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    ssh_authorized_keys:
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF4S1PBUth+UBRXeEV24xfMJdT0k38YOQCZBb+8h7FVE oracle-vm
      - ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINXUmDB/lAfD742LfKE66rTSQlTKv724CGUN344L5BE5 oci-ai-agent-runner
runcmd:
  - printf 'Port 22\\n' > /etc/ssh/sshd_config.d/60-cloud-init.conf
  - systemctl restart ssh || systemctl restart sshd
  - iptables -I INPUT 1 -p tcp --dport 22 -j ACCEPT
  - mkdir -p /etc/iptables && iptables-save > /etc/iptables/rules.v4 || true
"""

launch = {
    "availabilityDomain": AD,
    "compartmentId": TENANCY,
    "displayName": "ai-agent-runner-fresh",
    "shape": "VM.Standard.A1.Flex",
    "shapeConfig": {"ocpus": 4.0, "memoryInGBs": 24.0},
    "imageId": IMAGE,
    "subnetId": SUBNET,
    "assignPublicIp": True,
    "hostnameLabel": "ai-agent-runner2",
    "metadata": {
        "ssh_authorized_keys": "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIF4S1PBUth+UBRXeEV24xfMJdT0k38YOQCZBb+8h7FVE oracle-vm\nssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAINXUmDB/lAfD742LfKE66rTSQlTKv724CGUN344L5BE5 oci-ai-agent-runner",
        "user_data": base64.b64encode(cloud_init.encode()).decode()
    },
    "bootVolumeSizeInGbs": 50
}

with open('/Users/danielstevens/fresh_launch.json', 'w') as f:
    json.dump(launch, f, indent=2)
print("wrote /Users/danielstevens/fresh_launch.json")
print("user_data bytes:", len(cloud_init))
