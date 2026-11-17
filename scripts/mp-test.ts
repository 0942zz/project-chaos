/**
 * End-to-end multiplayer test: starts the real server and drives nine real WebSocket clients.
 *   bun run scripts/mp-test.ts
 * Takes about three minutes (wheel spins and bonus animations run at their real length).
 */
import { CM_SEG_ANGLE, cmSegmentAt, type BonusState } from '../src/game/logic/bonus'
import { GravityBoard, aimToX } from '../src/game/physics/gravityBoard'
import { simulateSpin } from '../src/game/physics/wheelSim'

const PORT = 3555
const BASE = `http://localhost:${PORT}`
let failed = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const server = Bun.spawn(['bun', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), CHAOS_DB: ':memory:', CHAOS_FAST: '1', CHAOS_FORCE: '5,DON,TS,GD,CM' },
  stdout: 'ignore',
  stderr: 'inherit',
})
for (let i = 0; i < 50; i++) {
  if (await fetch(`${BASE}/api/info`).then((r) => r.ok).catch(() => false)) break
  await sleep(200)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any
class Client {
  ws!: WebSocket
  state: State = null
  errors: string[] = []
  token = ''
  id = 0
  constructor(readonly name: string) {}
  async signUp() {
    const r = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: this.name, password: 'secret12' }) })
    const d = (await r.json()) as { token: string; user: { id: number } }
    this.token = d.token
    this.id = d.user.id
  }
  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${this.token}`)
      this.ws.onopen = () => resolve()
      this.ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data))
        if (m.t === 'state') this.state = m
        else if (m.t === 'error') this.errors.push(m.message)
      }
    })
  }
  send(m: object) { this.ws.send(JSON.stringify(m)) }
  act(a: string, extra: object = {}) { this.send({ t: 'act', a, ...extra }) }
  async until(pred: (s: State) => boolean, seconds = 60): Promise<boolean> {
    const end = Date.now() + seconds * 1000
    while (Date.now() < end) {
      if (this.state && pred(this.state)) return true
      await sleep(40)
    }
    return false
  }
}

const users = Array.from({ length: 9 }, (_, i) => new Client(`player${i + 1}`))
for (const u of users) await u.signUp()
const [host, p2, p3, p4, p5, p6, , p8, p9] = users
const seated = users.slice(0, 8)
const same = (f: (s: State) => unknown) => new Set(seated.map((u) => JSON.stringify(f(u.state)))).size === 1

/* ── accounts ── */
const dup = await fetch(`${BASE}/api/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'PLAYER1', password: 'secret12' }) })
ok('duplicate username rejected (case-insensitive)', dup.status === 409)
const bad = await fetch(`${BASE}/api/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'player1', password: 'wrong-pass' }) })
ok('wrong password rejected', bad.status === 401)
ok('profile needs a session', (await fetch(`${BASE}/api/me`)).status === 401)
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const up = await fetch(`${BASE}/api/avatar`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${host.token}` }, body: JSON.stringify({ image: png }) })
const av = await fetch(`${BASE}/api/avatar/${host.id}`)
ok('avatar upload and download', up.ok && av.ok && av.headers.get('content-type') === 'image/png')

/* ── rooms ── */
for (const u of users) await u.connect()
host.send({ t: 'create' })
await host.until((s) => !!s.room)
const code: string = host.state.room.code
ok('room created with a 4-letter code, creator is host', /^[A-Z]{4}$/.test(code) && host.state.room.hostId === host.id)
for (const u of users.slice(1, 8)) u.send({ t: 'join', code: code.toLowerCase() })
await host.until((s) => s.room.players.length === 8)
ok('eight players seated', host.state.room.players.length === 8)
p9.send({ t: 'join', code })
await sleep(400)
ok('ninth player refused', p9.state === null && p9.errors.some((e) => e.includes('full')), p9.errors.join(' | '))
p2.send({ t: 'start' })
await sleep(300)
ok('only the host can start', host.state.room.started === false && p2.errors.length === 1)
host.send({ t: 'start' })
for (const u of seated) await u.until((s) => s.phase === 'BETTING')

/* ── round 1: number ── */
host.act('bet', { spot: '5', amount: 10 })
p2.act('bet', { spot: '5', amount: 25 })
p2.act('bet', { spot: '1', amount: 5 })
p3.act('bet', { spot: '5', amount: 7 })
p4.act('bet', { spot: '2', amount: 100 })
p4.act('undo')
await sleep(400)
ok('shared wallet debited once per valid bet', same((s) => s.balance) && host.state.balance === 960, `balance=${host.state.balance}`)
ok('invalid chip rejected', p3.errors.length === 1)
ok('each player sees own stake and the team total', p2.state.myBets['5'] === 25 && host.state.myBets['5'] === 10 && p8.state.bets['5'] === 35)
p5.act('lock')
await sleep(200)
ok('only the host can spin early', p5.state.phase === 'BETTING')
host.act('lock')
for (const u of seated) await u.until((s) => s.phase === 'SPINNING', 10)
p6.act('bet', { spot: '10', amount: 10 })
const spin = host.state.spin
for (const u of seated) await u.until((s) => s.phase === 'RESULT', 30)
ok('late bet refused', p6.errors.some((e) => e.includes('closed')) && host.state.bets['10'] === 0)
ok('all clients see the same result', same((s) => s.result) && host.state.result.type === '5', JSON.stringify(host.state.result))
ok('client-side replay of the spin lands on the server result', simulateSpin(spin.startAngle, spin.omega0).finalIndex === host.state.result.index)
ok('number payout credited once to the shared wallet', same((s) => s.balance) && host.state.balance === 960 + 35 * 6, `balance=${host.state.balance}`)

async function nextBonus(kind: string, bettor: Client): Promise<number> {
  for (const u of seated) await u.until((s) => s.phase === 'BETTING' && s.result === null, 30)
  const before = host.state.balance
  bettor.act('bet', { spot: kind, amount: 10 })
  await sleep(200)
  host.act('lock')
  for (const u of seated) await u.until((s) => s.phase === 'BONUS_ACTIVE', 45)
  ok(`${kind}: bonus opened for everyone`, same((s) => s.bonus?.kind) && host.state.bonus?.kind === kind)
  return before - 10
}
async function settle(kind: string, base: number): Promise<number> {
  for (const u of seated) await u.until((s) => s.phase === 'BONUS_RESULT', 90)
  const m: number = host.state.bonusMultiplier
  ok(`${kind}: same multiplier and wallet on every client`, same((s) => [s.bonusMultiplier, s.balance]) && host.state.balance === base + 10 * (m + 1), `mult=${m} balance=${host.state.balance}`)
  return m
}

/* ── DOUBLE ── */
let base = await nextBonus('DON', p3)
p4.act('donFlip')
p5.act('donFlip')
let m = await settle('DON', base)
const don = host.state.bonus as Extract<BonusState, { kind: 'DON' }>
ok('DON: pays the face that landed', m === (don.outcome === 'SUN' ? don.sun : don.moon))

/* ── TREASURE ── */
base = await nextBonus('TS', p2)
await host.until((s) => s.bonus.status === 'pick', 15)
ok('TS: hidden multipliers are not sent before the pick', p8.state.bonus.values.every((v: number) => v === 0))
p5.act('tsPick', { index: 7 })
p6.act('tsPick', { index: 30 })
m = await settle('TS', base)
ok('TS: first pick wins and pays that target', host.state.bonus.pick === 7 && host.state.bonus.values[7] === m)

/* ── GRAVITY ── */
base = await nextBonus('GD', p6)
p2.act('gdDrop', { aim: 0.31 })
let lastDrop: State = null
const watch = setInterval(() => { if (host.state?.bonus?.kind === 'GD' && host.state.bonus.status === 'dropping') lastDrop = host.state.bonus }, 30)
m = await settle('GD', base)
clearInterval(watch)
const gd = host.state.bonus as Extract<BonusState, { kind: 'GD' }>
ok('GD: pays the slot the ball landed in', gd.slot !== null && gd.slots[gd.slot] === m, `doubles=${gd.doubles}`)
const board = await GravityBoard.create()
board.drop(aimToX(lastDrop.aim) + lastDrop.jitter)
for (let i = 0; i < 240 * 60 && board.landedSlot === null; i++) board.advance(1 / 240)
ok('GD: client-side physics replay lands in the server slot', board.landedSlot === gd.slot, `replay=${board.landedSlot} server=${gd.slot}`)

/* ── CHAOS ── */
base = await nextBonus('CM', p4)
p6.act('cmPick', { index: 2 })
p3.act('cmPick', { index: 0 })
for (const u of seated) await u.until((s) => s.phase === 'BONUS_RESULT', 120)
const cm = host.state.bonus as Extract<BonusState, { kind: 'CM' }>
const bs = host.state.bonusSpin
const replay = simulateSpin(bs.startAngle, bs.omega0, CM_SEG_ANGLE)
ok('CM: first pointer pick wins', cm.pick === 2)
ok('CM: client-side replay of the grand wheel matches the server', cmSegmentAt(replay.finalAngle, 2) === cm.landed![2])
m = await settle('CM', base)
ok('CM: pays the segment under the chosen pointer', cm.wheel[cm.landed![2]] === m, `boosts=${cm.boosts}`)

/* ── disconnection ── */
host.ws.close()
await p2.until((s) => s.room.hostId !== host.id && s.room.players.find((p: State) => p.id === host.id)?.connected === false, 5)
ok('host disconnect: marked offline, host role passes on', p2.state.room.hostId !== host.id && p2.state.room.players.length === 8)
await host.connect()
host.send({ t: 'join', code })
await p2.until((s) => s.room.players.find((p: State) => p.id === host.id)?.connected === true, 5)
ok('reconnect keeps the seat', p2.state.room.players.find((p: State) => p.id === host.id)?.connected === true && host.state?.room.code === code)
p8.send({ t: 'leave' })
await p2.until((s) => s.room.players.length === 7, 5)
p9.errors = []
p9.send({ t: 'join', code })
await p9.until((s) => !!s.room, 5)
ok('a freed seat can be taken', p9.state?.room.players.length === 8)
const round = p2.state.round
await p2.until((s) => s.round > round, 60)
ok('rounds keep running after players come and go', p2.state.round > round)

/* ── persistence ── */
const me = (await (await fetch(`${BASE}/api/me`, { headers: { authorization: `Bearer ${p2.token}` } })).json()) as { user: { stats: { rounds: number; staked: number } }; history: unknown[] }
ok('stats and history recorded per player', me.user.stats.rounds === 2 && me.user.stats.staked === 40 && me.history.length === 2, JSON.stringify(me.user.stats))

server.kill()
console.log(failed === 0 ? '\nAll multiplayer checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
