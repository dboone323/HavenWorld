id
sudo -n true; echo SUDO_EXIT:$?
sudo -n iptables -S INPUT 2>&1 | head -30
sudo -n sshd -T 2>&1 | grep -i -E '^port |^allowusers|^passwordauth' | head
ss -tln 2>&1 | grep -E ':22 |:2222 '
grep -n -E '^[#[:space:]]*Port' /etc/ssh/sshd_config /etc/ssh/sshd_config.d/*.conf 2>&1
