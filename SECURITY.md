# 🛡️ Security Policy

HavenWorld takes player security, privacy, and data integrity very seriously. This document outlines our vulnerability reporting policy, supported versions, and best practices.

---

## 🔒 Supported Versions

Only the latest commit on the `main` branch deployed to the production environment receives active security patches.

| Branch / Version | Supported          |
| :---             | :---               |
| `main` (latest)  | :white_check_mark: |
| Alpha / Pre-releases | :white_check_mark: |
| Historical forks | :x:                |

---

## 🚨 Reporting a Vulnerability

If you discover a security vulnerability in HavenWorld (such as authentication bypass, arbitrary code execution, SQL injection, denial of service, or item duplication exploits):

1. **Do NOT open a public GitHub issue or discuss it in public chat channels.**
2. Email the maintainer directly at **security@havenworld.me** or contact `@dboone323` via GitHub Security Advisories.
3. Include the following details:
   - Detailed description of the vulnerability and its potential impact.
   - Exact step-by-step reproduction instructions or a minimal proof-of-concept.
   - Affected endpoints, parameters, or WebSocket message types.
   - Your name or handle if you would like to be credited upon resolution.

### Response Timelines
- **Initial Acknowledgment**: Within 24 hours.
- **Triage & Assessment**: Within 48 hours.
- **Fix & Deployment**: Target within 5 business days for critical issues.

---

## 🛡️ Security Architecture & Guardrails

- **Server-Side Authority**: Clients never dictate spatial position, coin balances, or inventory contents. All mutations are validated and executed server-side.
- **Rate Limiting**: Chat messages, movement packets, and authentication endpoints are bounded by rate limiters.
- **Input Sanitization**: All chat messages and user names pass through sanitization pipelines (`sanitizeChat`, `moderateChat`, PII redaction) before broadcasting.
- **Encrypted Ingress**: All public network traffic is proxied through Cloudflare with TLS 1.3 encryption and WebSocket protection.
- **Zero-Secret Client Bundles**: Vite and client builds never package private keys, Supabase service keys, or admin secrets.
