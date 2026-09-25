#!/bin/bash
echo "=UPTIME"; uptime -p
echo "=SSHD_CFG"; grep -iE '^Port|^AllowTcpForwarding|^AllowUsers' /etc/ssh/sshd_config
echo "=DROPINS"; ls /etc/ssh/sshd_config.d/ 2>/dev/null | paste -sd,
echo "=SVC"; systemctl is-active ssh ssh.socket 2>&1 | paste -sd,
echo "=SOCKET_UNIT"; systemctl cat ssh.socket 2>/dev/null | grep -E 'ListenStream|^# /' | paste -sd';'
echo "=LISTEN"; ss -ltn 2>/dev/null | awk 'NR==1||/:22/'
echo "=IPT"; iptables -S INPUT 2>/dev/null | head -6
