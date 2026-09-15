# HavenWorld — macOS-Side Implementation Plan

## Scope Definition
macOS-side work only. The Linux/server side (Supabase cloud deployment, Oracle Cloud VM,
server-side persistence logic) is handled separately. This manifest covers the local
development environment, build pipeline, and native macOS/iOS packaging.

## Phase 0: Foundation (macOS dev environment)
- [ ] 0.1 Fix 3 failing tests (fadeAlpha boundary, SWITCH_ROOM exclude, integration timeout)
- [ ] 0.2 Fix migrate-supabase.js CommonJS/ESM mismatch
- [ ] 0.3 Standardize "MiniWorld" -> "HavenWorld" (README, scripts, db file, console, docs)
- [ ] 0.4 Add Vite build pipeline (dev server + production static output)
- [ ] 0.5 Convert shared modules + server to TypeScript with typed protocol
- [ ] 0.6 Directory restructure: src/client/, src/server/, src/shared/types/

## Phase 3: Native Packaging (macOS/iOS)
- [ ] 3.1 Capacitor iOS project (Xcode 27, iOS 27 SDK, WKWebView full-screen)
- [ ] 3.2 Electron macOS desktop app (arm64 Apple Silicon native)
- [ ] 3.3 Tauri alternative config for lighter desktop build

## Environment
- macOS 27.0, Xcode 27.0 (27A5252f), Swift 6.4
- Node v26.7.0, npm 11.19.0
- Repository: /Users/danielstevens/Developer/HavenWorld