# HavenWorld — Current Status & Multi-Device Setup

## Server Status
- **Local**: http://localhost:3999 (always available)
- **Auto-restart**: Server + Cloudflare tunnel run inside tmux session `havenworld`
- **Tunnel**: Auto-restarts on crash via `/home/ubuntu/.hermes/haven-reconnect.sh`

## Getting the Current Tunnel URL
```bash
/home/ubuntu/.hermes/haven-tunnel-url.sh
```
This reads the latest URL from the tunnel log and prints HTTP + WSS endpoints.

## Safari Compatibility
- Tunnel now uses `--protocol http2` (not QUIC) for Safari compatibility
- Safari 18+ supports `wss://` over HTTP/2 tunnels

## Free Cloudflare Tunnel Options
1. **Quick Tunnels** (what we use): `cloudflared tunnel --url http://localhost:3999`
   - Free, no account needed
   - URL changes on each restart (read from log)
   - No uptime guarantee (terms of service)
2. **Named Tunnels** (free with Cloudflare account):
   - Stable URL, better uptime
   - Requires `cloudflared login` to a Cloudflare account
   - Set up via `cloudflared tunnel create havenworld`

## Multi-Device Access
To open HavenWorld on another device:
1. Run `/home/ubuntu/.hermes/haven-tunnel-url.sh` to get the current URL
2. On the other device, open that URL in any modern browser (Chrome, Safari, Firefox, etc.)
3. WebSocket connects automatically via `wss://`

## Auto-Restart Architecture
```
tmux session "havenworld"
  ├── HavenWorld server (port 3999, node src/server/server.ts)
  └── cloudflared tunnel (--protocol http2 --url http://localhost:3999)
```
Both are managed by `/home/ubuntu/.hermes/haven-reconnect.sh` which:
- Starts the server, waits for it to be ready
- Starts the tunnel, logs the URL to `/home/ubuntu/havenworld-tunnel.log`
- If either dies, kills both and restarts from the top after 3s

## Persistent SSH Session
The tmux sessions persist independently of SSH. If your SSH session disconnects:
- The tmux sessions continue running
- Reconnect with: `tmux attach -t havenworld` to see server logs
- Or: `tmux attach -t cloudflare-tunnel` to see tunnel logs

## To prevent SSH timeout/disconnect:
Add to `~/.ssh/config` on your client machine:
```
Host havenworld-server
    HostName <server-ip>
    User ubuntu
    ServerAliveInterval 60
    ServerAliveCountMax 3
    LogLevel ERROR
```
Or use `tmux` session persistence (which is already set up).
