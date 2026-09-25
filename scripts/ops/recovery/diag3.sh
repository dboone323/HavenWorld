echo "=BANNER_LOCALHOST"
timeout 4 bash -c 'exec 3<>/dev/tcp/127.0.0.1/2222 && head -c 40 <&3' 2>&1
echo "=BANNER_PUBLICIP_2222"
timeout 4 bash -c 'exec 3<>/dev/tcp/147.224.164.228/2222 && head -c 40 <&3' 2>&1
echo "=BANNER_PUBLICIP_22"
timeout 4 bash -c 'exec 3<>/dev/tcp/147.224.164.228/22 && head -c 40 <&3' 2>&1
echo "=BIN"
command -v iptables iptables-legacy nft ufw 2>&1 | paste -sd,
echo "=NFT_RULESET"
nft list ruleset 2>&1 | head -22
