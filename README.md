# HavenWorld

A browser-based social virtual world — open source, community-driven.

**Game URL:** https://havenworld-game.pages.dev (Custom domain: https://havenworld.me)

## Tech Stack

Node.js 22 | Socket.io 4 | Phaser 3 | PostgreSQL 16 | Redis 7 | Vite 6 | Cloudflare Pages

## Local Setup

**Prerequisites:** Node.js 22+, pnpm 9+, Docker Desktop

1. `git clone git@github.com:dboone323/HavenWorld.git && cd HavenWorld`
2. `pnpm install`
3. `docker compose -f docker-compose.dev.yml up -d`
4. `cp apps/server/.env.example apps/server/.env` # then fill in values
5. `cd apps/server && npx prisma migrate dev`
6. `pnpm dev` # from repo root — starts both server and client

## Community

Discord: [invite link — add after creating Discord server]

## License

GPL-3.0
