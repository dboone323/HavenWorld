#!/bin/bash
# Verify ORACLE_SSH_KEY matches ~/.ssh/oracle_arm
ssh -i ~/.ssh/oracle_arm -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new havenworld@147.224.164.228 "echo MATCH_OK" 2>&1
