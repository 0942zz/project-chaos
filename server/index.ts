/**
 * PROJECT CHAOS — LAN server. Run with Bun:  bun server/index.ts
 * Serves the built game (dist/), the account API and the multiplayer WebSocket on one port.
 */
import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join, normalize } from 'node:path'
import type { ServerWebSocket } from 'bun'
import { MAX_PLAYERS, Room, START_BALANCE, type RoundRecord, type Wallet } from './room'

const PORT = Number(process.env.PORT ?? 3000)
const ROOT = join(import.meta.dir, '..')
const DIST = join(ROOT, 'dist')
const DATA = process.env.CHAOS_DB ?? join(ROOT, 'data', 'chaos.sqlite')
if (DATA !== ':memory:') mkdirSync(join(DATA, '..'), { recursive: true })

/* ───────── database ───────── */

const db = new Database(DATA)
db.run('PRAGMA journal_mode = WAL')
db.run(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  avatar TEXT,
  created_at INTEGER NOT NULL
)`)
db.run('CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER NOT NULL, created_at INTEGER NOT NULL)')
db.run(`CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL, room TEXT NOT NULL, round INTEGER NOT NULL,
  result TEXT NOT NULL, multiplier REAL NOT NULL, stake INTEGER NOT NULL, win INTEGER NOT NULL, at INTEGER NOT NULL
)`)
db.run('CREATE INDEX IF NOT EXISTS history_user ON history (user_id, id DESC)')
// Migration: databases created before individual wallets get the balance column here.
if (!(db.query('PRAGMA table_info(users)').all() as { name: string }[]).some((c) => c.name === 'balance')) {
  db.run(`ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT ${START_BALANCE}`)
}

const wallet: Wallet = {
  get: (id) => (db.query('SELECT balance FROM users WHERE id = ?').get(id) as { balance: number } | null)?.balance ?? 0,
  add: (id, delta) => {
    // One atomic statement; the wallet can never go below zero.
    db.run('UPDATE users SET balance = MAX(0, balance + ?) WHERE id = ?', [Math.trunc(delta), id])
    return wallet.get(id)
  },
  set: (id, value) => void db.run('UPDATE users SET balance = ? WHERE id = ?', [Math.max(0, Math.trunc(value)), id]),
}

interface UserRow { id: number; username: string; password_hash: string; avatar: string | null; balance: number }

/** Everything is derived from the server's own history rows — one row per round a player staked in. */
const STATS_SQL = `SELECT COUNT(*) AS games,
  COALESCE(SUM(win > 0), 0) AS victories,
  COALESCE(SUM(win = 0), 0) AS losses,
  COALESCE(SUM(stake), 0) AS wagered,
  COALESCE(SUM(win - stake), 0) AS net,
  COALESCE(MAX(win), 0) AS biggestWin
  FROM history WHERE user_id = ?`
interface Stats { games: number; victories: number; losses: number; wagered: number; net: number; biggestWin: number; winPct: number }

const publicUser = (u: UserRow) => {
  const s = db.query(STATS_SQL).get(u.id) as Omit<Stats, 'winPct'>
  const stats: Stats = { ...s, winPct: s.games ? Math.round((s.victories / s.games) * 1000) / 10 : 0 }
  return { id: u.id, name: u.username, hasAvatar: u.avatar !== null, balance: wallet.get(u.id), stats }
}

/** Win percentage needs a few rounds before it means anything. */
const MIN_GAMES_FOR_PCT = 5
function leaderboard() {
  const rows = db.query(`SELECT u.id, u.username AS name, u.avatar IS NOT NULL AS hasAvatar, u.balance,
      COUNT(h.id) AS games, COALESCE(SUM(h.win > 0), 0) AS victories, COALESCE(SUM(h.win - h.stake), 0) AS net
    FROM users u LEFT JOIN history h ON h.user_id = u.id GROUP BY u.id`).all() as
    { id: number; name: string; hasAvatar: number; balance: number; games: number; victories: number; net: number }[]
  const top = (value: (r: (typeof rows)[number]) => number, keep: (r: (typeof rows)[number]) => boolean = () => true) =>
    rows.filter(keep).map((r) => ({ id: r.id, name: r.name, hasAvatar: !!r.hasAvatar, games: r.games, value: value(r) }))
      .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name)).slice(0, 10)
  return {
    minGamesForPct: MIN_GAMES_FOR_PCT,
    balance: top((r) => r.balance),
    net: top((r) => r.net, (r) => r.games > 0),
    victories: top((r) => r.victories, (r) => r.games > 0),
    winPct: top((r) => Math.round((r.victories / r.games) * 1000) / 10, (r) => r.games >= MIN_GAMES_FOR_PCT),
  }
}

function userFromToken(token: string | null): UserRow | null {
  if (!token) return null
  return db.query('SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?').get(token) as UserRow | null
}

function newSession(userId: number): string {
  const token = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
  db.run('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)', [token, userId, Date.now()])
  return token
}

const saveRounds = (rows: RoundRecord[]) => {
  const stmt = db.prepare('INSERT INTO history (user_id, room, round, result, multiplier, stake, win, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
  for (const r of rows) stmt.run(r.userId, r.room, r.round, r.result, r.multiplier, r.stake, r.win, Date.now())
}

/* ───────── rooms and sockets ───────── */

interface Conn { userId: number; name: string; room: string | null }
type Socket = ServerWebSocket<Conn>

const rooms = new Map<string, Room>()
const sockets = new Map<number, Set<Socket>>()
const graceTimers = new Map<number, ReturnType<typeof setTimeout>>()

function broadcast(room: Room): void {
  for (const id of room.members.keys()) {
    const set = sockets.get(id)
    if (!set) continue
    const payload = JSON.stringify(room.snapshot(id))
    for (const ws of set) if (ws.data.room === room.code) ws.send(payload)
  }
}

function newCode(): string {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
  for (;;) {
    const code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join('')
    if (!rooms.has(code)) return code
  }
}

function leaveRoom(ws: Socket, gone: boolean): void {
  const code = ws.data.room
  if (!code) return
  ws.data.room = null
  const room = rooms.get(code)
  if (!room) return
  const stillHere = [...(sockets.get(ws.data.userId) ?? [])].some((s) => s !== ws && s.data.room === code)
  if (stillHere) return
  room.drop(ws.data.userId, gone)
  if (!gone) {
    // A dropped connection keeps its seat for a minute so the player can reconnect.
    const id = ws.data.userId
    clearTimeout(graceTimers.get(id))
    graceTimers.set(id, setTimeout(() => {
      const r = rooms.get(code)
      if (r && r.members.get(id)?.connected === false) {
        r.drop(id, true)
        if (r.empty) { r.dispose(); rooms.delete(code) }
      }
    }, 60_000))
  }
  if (room.empty) {
    room.dispose()
    rooms.delete(code)
  }
}

function onMessage(ws: Socket, raw: string): void {
  let msg: Record<string, unknown>
  try {
    msg = JSON.parse(raw)
  } catch {
    return
  }
  const fail = (message: string) => ws.send(JSON.stringify({ t: 'error', message }))
  const user = db.query('SELECT * FROM users WHERE id = ?').get(ws.data.userId) as UserRow | null
  if (!user) return fail('Account not found.')
  const me = { id: user.id, name: user.username, hasAvatar: user.avatar !== null }

  if (msg.t === 'create') {
    leaveRoom(ws, true)
    const room = new Room(newCode(), me, broadcast, saveRounds, wallet)
    rooms.set(room.code, room)
    ws.data.room = room.code
    broadcast(room)
  } else if (msg.t === 'join') {
    const code = String(msg.code ?? '').trim().toUpperCase()
    const room = rooms.get(code)
    if (!room) return fail(`No room with code ${code || '—'}.`)
    if (ws.data.room && ws.data.room !== code) leaveRoom(ws, true)
    ws.data.room = code
    clearTimeout(graceTimers.get(user.id))
    const error = room.join(me)
    if (error) {
      ws.data.room = null
      return fail(error)
    }
  } else if (msg.t === 'leave') {
    leaveRoom(ws, true)
    ws.send(JSON.stringify({ t: 'left' }))
  } else {
    const room = ws.data.room ? rooms.get(ws.data.room) : null
    if (!room) return
    const error = msg.t === 'start' ? room.start(user.id) : msg.t === 'act' ? room.act(user.id, msg) : null
    if (error) fail(error)
  }
}

/* ───────── HTTP ───────── */

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer /, '') ?? null
const lanAddresses = () =>
  Object.values(networkInterfaces()).flat().filter((n) => n && n.family === 'IPv4' && !n.internal).map((n) => n!.address)

async function api(req: Request, path: string): Promise<Response> {
  if (path === '/api/info') return json({ ok: true, port: PORT, addresses: lanAddresses(), maxPlayers: MAX_PLAYERS })

  if ((path === '/api/register' || path === '/api/login') && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown }
    const username = String(body.username ?? '').trim()
    const password = String(body.password ?? '')
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return json({ error: 'Username: 3–16 letters, digits or underscores.' }, 400)
    if (password.length < 6 || password.length > 128) return json({ error: 'Password: at least 6 characters.' }, 400)
    let user = db.query('SELECT * FROM users WHERE username = ?').get(username) as UserRow | null
    if (path === '/api/register') {
      if (user) return json({ error: 'That username is already taken.' }, 409)
      const hash = await Bun.password.hash(password)
      db.run('INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)', [username, hash, Date.now()])
      user = db.query('SELECT * FROM users WHERE username = ?').get(username) as UserRow
    } else if (!user || !(await Bun.password.verify(password, user.password_hash))) {
      return json({ error: 'Wrong username or password.' }, 401)
    }
    return json({ token: newSession(user.id), user: publicUser(user) })
  }

  const avatar = path.match(/^\/api\/avatar\/(\d+)$/)
  if (avatar && req.method === 'GET') {
    const row = db.query('SELECT avatar FROM users WHERE id = ?').get(Number(avatar[1])) as { avatar: string | null } | null
    const m = row?.avatar?.match(/^data:(image\/(?:jpeg|png|webp));base64,(.+)$/)
    if (!m) return new Response('no avatar', { status: 404 })
    return new Response(Buffer.from(m[2], 'base64'), { headers: { 'content-type': m[1], 'cache-control': 'no-cache' } })
  }

  const user = userFromToken(bearer(req))
  if (!user) return json({ error: 'Please sign in again.' }, 401)

  if (path === '/api/me') {
    const history = db.query('SELECT room, round, result, multiplier, stake, win, at FROM history WHERE user_id = ? ORDER BY id DESC LIMIT 12').all(user.id)
    return json({ user: publicUser(user), history })
  }
  if (path === '/api/leaderboard') return json(leaderboard())
  if (path === '/api/logout' && req.method === 'POST') {
    db.run('DELETE FROM sessions WHERE token = ?', [bearer(req)])
    return json({ ok: true })
  }
  if (path === '/api/avatar' && req.method === 'POST') {
    const body = (await req.json().catch(() => ({}))) as { image?: unknown }
    const image = String(body.image ?? '')
    if (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(image) || image.length > 300_000) {
      return json({ error: 'Avatar must be a JPEG, PNG or WebP image under 200 KB.' }, 400)
    }
    db.run('UPDATE users SET avatar = ? WHERE id = ?', [image, user.id])
    return json({ user: publicUser({ ...user, avatar: image }) })
  }
  return json({ error: 'Not found.' }, 404)
}

async function serveStatic(path: string): Promise<Response> {
  if (!existsSync(DIST)) return new Response('The game is not built yet. Run: bun run build', { status: 503 })
  const safe = normalize(path).replace(/^([/\\]|\.\.)+/, '')
  const file = Bun.file(join(DIST, safe || 'index.html'))
  if (safe && (await file.exists())) return new Response(file)
  return new Response(Bun.file(join(DIST, 'index.html')), { headers: { 'content-type': 'text/html; charset=utf-8' } })
}

Bun.serve<Conn, never>({
  port: PORT,
  hostname: '0.0.0.0',
  async fetch(req, server) {
    const url = new URL(req.url)
    if (url.pathname === '/ws') {
      const user = userFromToken(url.searchParams.get('token'))
      if (!user) return new Response('unauthorized', { status: 401 })
      return server.upgrade(req, { data: { userId: user.id, name: user.username, room: null } })
        ? (undefined as unknown as Response)
        : new Response('upgrade failed', { status: 400 })
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await api(req, url.pathname)
      } catch (error) {
        console.error(error)
        return json({ error: 'Server error.' }, 500)
      }
    }
    return serveStatic(decodeURIComponent(url.pathname))
  },
  websocket: {
    open(ws) {
      const set = sockets.get(ws.data.userId) ?? new Set<Socket>()
      set.add(ws)
      sockets.set(ws.data.userId, set)
    },
    message(ws, message) {
      onMessage(ws, typeof message === 'string' ? message : message.toString())
    },
    close(ws) {
      leaveRoom(ws, false)
      sockets.get(ws.data.userId)?.delete(ws)
    },
  },
})

console.log(`\nPROJECT CHAOS server running on port ${PORT}`)
console.log(`  This PC:        http://localhost:${PORT}`)
for (const a of lanAddresses()) console.log(`  Other devices:  http://${a}:${PORT}`)
console.log('\nKeep this window open while people are playing.\n')
