#!/bin/bash
set -e
INST=ocid1.instance.oc1.us-chicago-1.anxxeljtmwdgjgacz2zo6xk65k62kbscd62stcztuvft4hgzsn2edrv36bja
oci compute instance update --instance-id "$INST" \
  --agent-config file:///Users/danielstevens/bastion_agent_config.json \
  --force
echo "BASTION_ENABLE_DONE"
