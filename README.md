# HideOut

Offline-first **LAN multiplayer 3D prop-hunt**, shipped as an installable **PWA**.
Play with 8–12 friends on the same Wi-Fi / hotspot — no internet, cloud, backend,
or accounts required during normal play.

> Full architecture, networking model, PWA strategy, and roadmap live in the
> approved design plan. This README covers running the code.

## Stack

- **TypeScript** (strict) · **Vite** · **Svelte 5** (UI shell) · **Babylon.js** (3D, added in M1)
- **WebRTC DataChannels** transport · host-authoritative star topology
- **vite-plugin-pwa** (Workbox) service worker + manifest
- **Vitest** (unit/integration) · **Playwright** (E2E, added later)

## Architecture (layers, dependencies point downward only)

```
app (Svelte)  →  platform (PWA)  →  render / audio / input  →  net  →  game  →  core
```

`core/` and `game/` are **pure TypeScript** (no DOM, Babylon, or WebRTC) so they are
fully unit-testable and reusable for a future dedicated server or native build.

## Getting started

```bash
npm install
npm run dev          # dev server
npm test             # unit tests (Vitest)
npm run typecheck    # tsc --noEmit + svelte-check
npm run lint         # eslint
npm run build        # production build (emits service worker + manifest)
npm run preview      # serve the production build (verify install/offline)
```

## Status — Milestone 1 (vertical slice) — code complete

**M0 kernel** (all unit-tested): `core/math` · `core/time` (fixed timestep) ·
`core/events` (typed EventBus) · `core/di` · `core/ecs` (generational ids,
sparse-set stores) · `core/fsm` · `core/pool` · `platform/capabilities`.

**M1 game domain** (`game/`, pure TS): deterministic XZ collide-and-slide +
ray physics · shared movement step (host sim ≡ client prediction) ·
`HostSimulation` (authoritative rules: possession, hunter combat with
line-of-sight, taunts, round FSM, win conditions, anti-cheat validation) ·
Warehouse map (~45 procedural props).

**M1 netcode** (`net/`): bit-packed input/snapshot codecs (12 players ≈ 130 B
per snapshot) · msgpack reliable events · `PeerLink` transport abstraction —
WebRTC (no ICE servers, offline LAN, non-trickle compressed SDP) + deterministic
loopback with latency/loss simulation · client prediction + reconciliation +
snapshot interpolation · Host/Client sessions. Integration-tested end-to-end,
including a 30% packet-loss run.

**M1 presentation**: Babylon.js first-person renderer (procedural low-poly prop
archetypes, one draw call each; adaptive resolution tuner) · touch joystick +
drag-look + keyboard/mouse input · synthesized Web Audio SFX (zero audio assets)
· IndexedDB save · Svelte 5 screens (menu → host/join with QR + paste signaling
→ lobby → game HUD → results).

### Verify

```bash
npm test        # 99 unit + integration tests
npm run build   # emits PWA (sw + manifest); Babylon lazy-loads as its own chunk
npm run e2e     # real two-tab WebRTC host↔join round in headless Chrome
```

**Real-device check**: `npm run build && npm run preview -- --host`, open the
LAN URL on two phones on the same Wi-Fi, host → invite (QR) → join → play.

**Known slice limitations** (planned, not bugs): snapshot delta-compression and
interest management deferred to Alpha (bandwidth is already tiny at this scale);
mid-round joins are rejected (spectate-on-join is Alpha); host migration and
reconnection land in Alpha; taunts are optional-only (no forced taunt yet).
