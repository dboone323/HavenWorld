echo "=ID"
id 2>&1
echo "=SUDO"
sudo -n true 2>&1 && echo SUDO_OK || echo SUDO_NO
echo "=IPT_INPUT_SUDO"
sudo -n iptables -S INPUT 2>&1 | head -12
