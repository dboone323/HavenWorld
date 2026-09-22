#!/bin/bash
# Verify ORACLE_SSH_KEY matches ~/.ssh/instance-20260922.key
ssh -i ~/.ssh/instance-20260922.key -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new ubuntu@147.224.145.168 "echo MATCH_OK" 2>&1
