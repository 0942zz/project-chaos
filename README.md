# PROJECT CHAOS

A browser-based 3D game show: a physics-driven prize wheel, two hosts, and four playable bonus games.

Chaos Credits are fictional — no real money, deposits or withdrawals.

## Install on a Windows PC

1. Install [Bun](https://bun.sh) (once). In PowerShell:

   ```powershell
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

   Close and reopen the terminal afterwards.

2. Get the project and install its packages:

   ```bash
   git clone -b v2 https://github.com/0942zz/project-chaos.git
   cd project-chaos
   bun install
   ```

   No Git on the PC? On GitHub choose the `v2` branch, then Code → Download ZIP, unzip it and run `bun install` inside the folder.

3. Start it:

   ```bash
   bun run start
   ```

   This builds the game and starts the server. Open http://localhost:3000 on the same PC.

Everything the game needs (models, textures, fonts, sounds) is in the repository or generated in code; nothing else has to be downloaded. The account database is created automatically in `data/` on first start and is not part of the repository, so accounts and balances do not travel between PCs.

## Development mode

```bash
bun --bun run dev
```

Then open http://localhost:5173. Single player works on its own; for multiplayer also run `bun run server` in a second terminal.

Single player can also run without Bun (`npm install`, `npm run dev`), but the multiplayer server needs Bun.

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


## LAN multiplayer

Up to 8 players per room see the same wheel and bonus games. Every account has its own wallet (1,000 Chaos Credits to start), private bets, history and statistics; the same account on two devices stays in sync. The host PC runs the server (Bun required) and must stay on:

```bash
bun run start
```

It prints the addresses to open. Other devices on the same network open `http://<host-ip>:3000` in a browser, create an account, and join with the 4-letter room code. Accounts and history are stored in `data/chaos.sqlite` on the host. The firewall on the host must allow port 3000.

Automated multiplayer test (nine real clients, about three minutes): `bun run scripts/mp-test.ts`
