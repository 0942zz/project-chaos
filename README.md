# PROJECT CHAOS

A browser-based 3D game show: a physics-driven prize wheel, an animated host, and four playable bonus games (Double or Nothing, Treasure Storm, Gravity Drop, Chaos Mode).

Demo credits only — no real money, deposits or withdrawals.

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

The static site is written to `dist/`.

## URL options

- `?dev` — buttons to force the result of the next spin (useful for reaching bonus games)
- `?seed=123` — replay an identical sequence of outcomes
- `?fast` — shorter phase timers

## Tech

React, TypeScript, Three.js, React Three Fiber, Drei, Rapier 2D, Zustand, Web Audio API, Vite.

Game logic lives in `src/game/` and is independent of rendering (`src/components/`).
