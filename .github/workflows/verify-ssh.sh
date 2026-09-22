#!/bin/bash
# Verify ORACLE_SSH_KEY matches ~/.ssh/oci_ai_agent_runner
ssh -i ~/.ssh/oci_ai_agent_runner -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ubuntu@147.224.184.148 "echo MATCH_OK" 2>&1
