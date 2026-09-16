# HavenWorld — macOS-Side Implementation Plan

## Scope Definition
macOS-side work only. Linux/server side (Supabase cloud deployment, Oracle Cloud VM)
handled separately. Covers local development environment, build pipeline, and native
macOS/iOS packaging.

## Phase 0: Foundation (macOS dev environment) — COMPLETE
- [x] 0.1 Fix 4 bugs (fadeAlpha boundary, SWITCH_ROOM exclude, integration test hang, migrate-supabase ESM mismatch)
- [x] 0.2 Fix migrate-supabase.js -> .mjs (CommonJS/ESM mismatch)
- [x] 0.3 Standardize "MiniWorld" -> "HavenWorld" (README, scripts, db file, server.log, docs, schema)
- [x] 0.4 Add Vite to devDependencies, add pack:web/dev:web scripts
- [x] 0.5 TypeScript migration of shared modules + server + typed protocol
- [x] 0.6 Directory restructure: src/client/ + src/shared/types/

## Phase 3: Native Packaging (macOS/iOS) — COMPLETE
- [x] 3.1 Capacitor iOS project (Xcode 27, iOS 27 SDK, WKWebView full-screen)
- [x] 3.2 Electron macOS desktop app (arm64 Apple Silicon native)
- [x] 3.3 Tauri alternative config for lighter desktop build

## Verification
- 49 tests pass (45 unit + 4 integration, 0 failures)
- tsc --noEmit: CLEAN (0 errors)
- Server boots: SQLite mode on macOS, WebSocket connects, HTML served at localhost:3000
- iOS build: Xcode 27.0.27A5252f, iPhone 18 iOS 27.0 simulator, BUILD SUCCEEDED
- Electron: HavenWorld-0.1.0-arm64.dmg + .app built + launches on macOS 27 arm64
- Commit f1dd72c pushed to origin/main

## Environment
- macOS 27.0, Xcode 27.0 (27A5252f), Swift 6.4
- Node v26.7.0, npm 11.19.0
- Repository: /Users/danielstevens/Developer/HavenWorld