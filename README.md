# PROJECT CHAOS

A browser-based 3D game show: a physics-driven prize wheel, two hosts, and four playable bonus games.

Chaos Credits are fictional — no real money, deposits or withdrawals.

## Run it

Requires [Bun](https://bun.sh) (or Node.js 20+ with npm).

```bash
bun install
bun --bun run dev
```

Then open http://localhost:5173.

With npm instead: `npm install` then `npm run dev`.

## Build

```bash
bun --bun run build
```

The static site is written to `dist/`. It must be served by a web server; opening `index.html` directly does not work.

## The game

- **Main wheel** — 54 pockets: 1, 2, 5, 10 and four bonus pockets. Bonus pockets are never next to each other.
- **DOUBLE** — each face of a coin gets its own multiplier; the face that lands up pays.
- **TREASURE** — a wall of 60 targets shows its multipliers, covers and shuffles them, then you pick one before the clock runs out.
- **GRAVITY** — a ball falls through a pin board (Rapier physics). DOUBLE slots double the whole board and you drop again.
- **CHAOS** — back one of three pointers on the grand wheel. DOUBLE / TRIPLE segments multiply the wheel and it spins again.

Every result is read from where the wheel, coin or ball physically comes to rest.

## Hosts

The two hosts are scanned busts in `public/models/` (`delux`, `salsetta`). The source scans have no skeleton or animation clips, so they are animated procedurally (turn, lean, nod, hop).

To regenerate the web models from the original FBX scans (1M triangles each → 60k):

```bash
bun run scripts/convert-models.ts "C:/path/to/folder-with-DeLux-and-Salsetta"
```

## Checks

```bash
bun run scripts/check-logic.ts
bun x tsc --noEmit
```

## URL options

- `?dev` — buttons to force the result of the next spin (useful for reaching bonus games)
- `?seed=123` — replay an identical sequence of outcomes
- `?fast` — shorter phase timers

## Graphics profiles

Sound menu → Graphics: Auto, Ultra, High, Performance.

## Not built yet

LAN multiplayer, accounts and the shared wallet are planned but not implemented. The game is single-player only.

## Tech

React, TypeScript, Three.js, React Three Fiber, Drei, Rapier 2D, Zustand, Web Audio API, Vite.

Game logic lives in `src/game/` and is independent of rendering (`src/components/`).
