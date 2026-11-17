/**
 * End-to-end multiplayer test: starts the real server and drives real WebSocket clients.
 *   bun run scripts/mp-test.ts
 * Takes about two minutes (wheel spins and bonus animations run at their real length).
 * All "devices" here are simulated connections from this PC, not physical phones or laptops.
 */
import { Database } from 'bun:sqlite'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { simulateSpin } from '../src/game/physics/wheelSim'

const PORT = 3555
const BASE = `http://localhost:${PORT}`
const DB_FILE = join(tmpdir(), `chaos-test-${Date.now()}.sqlite`)
let failed = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const server = Bun.spawn(['bun', 'server/index.ts'], {
  env: { ...process.env, PORT: String(PORT), CHAOS_DB: DB_FILE, CHAOS_FAST: '1', CHAOS_FORCE: '5,DON,1' },
  stdout: 'ignore',
  stderr: 'inherit',
})
for (let i = 0; i < 50; i++) {
  if (await fetch(`${BASE}/api/info`).then((r) => r.ok).catch(() => false)) break
  await sleep(200)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type State = any
const post = (path: string, body: object, token?: string) =>
  fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
const getJson = async (path: string, token: string) => (await fetch(BASE + path, { headers: { authorization: `Bearer ${token}` } })).json() as Promise<State>

/** One browser tab / device. Several of them may belong to the same account. */
class Device {
  ws!: WebSocket
  state: State = null
  errors: string[] = []
  raw: string[] = []
  constructor(readonly account: Account) {}
  connect(): Promise<void> {
    return new Promise((resolve) => {
      this.ws = new WebSocket(`ws://localhost:${PORT}/ws?token=${this.account.token}`)
      this.ws.onopen = () => resolve()
      this.ws.onmessage = (e) => {
        const text = String(e.data)
        this.raw.push(text)
        const m = JSON.parse(text)
        if (m.t === 'state') this.state = m
        else if (m.t === 'error') this.errors.push(m.message)
      }
    })
  }
  send(m: object) { this.ws.send(JSON.stringify(m)) }
  act(a: string, extra: object = {}) { this.send({ t: 'act', a, ...extra }) }
  bet(spot: string, amount: number) { this.act('bet', { spot, amount }) }
  async until(pred: (s: State) => boolean, seconds = 60): Promise<boolean> {
    const end = Date.now() + seconds * 1000
    while (Date.now() < end) {
      if (this.state && pred(this.state)) return true
      await sleep(40)
    }
    return false
  }
}
class Account {
  token = ''
  id = 0
  constructor(readonly name: string) {}
  async signUp() {
    const d = (await (await post('/api/register', { username: this.name, password: 'secret12' })).json()) as { token: string; user: { id: number } }
    this.token = d.token
    this.id = d.user.id
  }
}

const accounts = Array.from({ length: 9 }, (_, i) => new Account(`player${i + 1}`))
for (const a of accounts) await a.signUp()
const [accA, accB, accC] = accounts

/* ── accounts ── */
ok('duplicate username rejected (case-insensitive)', (await post('/api/register', { username: 'PLAYER1', password: 'secret12' })).status === 409)
ok('wrong password rejected', (await post('/api/login', { username: 'player1', password: 'wrong-pass' })).status === 401)
ok('profile and leaderboard need a session', (await fetch(`${BASE}/api/me`)).status === 401 && (await fetch(`${BASE}/api/leaderboard`)).status === 401)
ok('new accounts start with 1,000 credits', (await getJson('/api/me', accC.token)).user.balance === 1000)

// Scenario 2: different starting balances (set directly in the database, as an admin would).
const db = new Database(DB_FILE)
db.run('UPDATE users SET balance = 5000 WHERE id = ?', [accA.id])
db.run('UPDATE users SET balance = 2000 WHERE id = ?', [accB.id])
db.close()

/* ── rooms ── */
const devices = accounts.map((a) => new Device(a))
for (const d of devices) await d.connect()
const [A, B, C] = devices
A.send({ t: 'create' })
await A.until((s) => !!s.room)
const code: string = A.state.room.code
for (const d of devices.slice(1, 8)) d.send({ t: 'join', code })
await A.until((s) => s.room.players.length === 8)
devices[8].send({ t: 'join', code })
await sleep(400)
ok('1. different accounts join the same room; a ninth is refused', A.state.room.players.length === 8 && devices[8].state === null && devices[8].errors.some((e) => e.includes('full')))
B.send({ t: 'start' })
await sleep(300)
ok('only the host can start', A.state.room.started === false && B.errors.length === 1)
A.send({ t: 'start' })
const table = [A, B, C]
for (const d of table) await d.until((s) => s.phase === 'BETTING')
ok('2. each account has its own starting balance', A.state.balance === 5000 && B.state.balance === 2000 && C.state.balance === 1000)

/* ── round 1: forced "5" ── */
A.bet('5', 100)
A.bet('5', 100)
A.bet('2', 25)
await sleep(300)
ok('3. player A places bets from A\'s wallet', A.state.balance === 4775 && A.state.bets['5'] === 200 && A.state.bets['2'] === 25)
const bSees = JSON.stringify(B.state)
ok('4. B receives nothing about A\'s bets or wallet', B.state.balance === 2000 && Object.values(B.state.bets).every((v) => v === 0) && !bSees.includes('4775') && !bSees.includes('myBets')
  && B.state.room.players.every((p: State) => Object.keys(p).sort().join() === 'connected,hasAvatar,id,name'))
B.bet('10', 10)
B.bet('5', 7)
await sleep(300)
ok('5. player B places a different bet; invalid chip rejected', B.state.bets['10'] === 10 && B.state.balance === 1990 && A.state.bets['10'] === 0 && B.errors.length === 2)
B.act('lock')
await sleep(200)
ok('only the host can spin early', B.state.phase === 'BETTING')
A.act('lock')
for (const d of table) await d.until((s) => s.phase === 'SPINNING', 10)
C.bet('5', 100)
const spin = A.state.spin
for (const d of table) await d.until((s) => s.phase === 'RESULT', 30)
ok('late bet refused', C.errors.some((e) => e.includes('closed')) && C.state.balance === 1000)
ok('6. both players see the same wheel result', JSON.stringify(A.state.result) === JSON.stringify(B.state.result) && A.state.result.type === '5'
  && simulateSpin(spin.startAngle, spin.omega0).finalIndex === B.state.result.index, JSON.stringify(A.state.result))
ok('7. only the account that backed the result is paid', A.state.balance === 4775 + 200 * 6 && A.state.lastWin === 1200 && B.state.lastWin === 0, `A=${A.state.balance}`)
ok('8. A\'s winnings do not touch other balances', B.state.balance === 1990 && C.state.balance === 1000, `B=${B.state.balance} C=${C.state.balance}`)

/* ── round 2: forced DOUBLE; same account on two devices; reconnection ── */
const A2 = new Device(accA)
await A2.connect()
A2.send({ t: 'join', code })
for (const d of [...table, A2]) await d.until((s) => s.phase === 'BETTING' && s.result === null, 30)
ok('9a. second device of the same account sees the same wallet', A2.state.balance === 5975 && A.state.room.players.length === 8)
A.bet('DON', 100)
await A2.until((s) => s.bets.DON === 100, 3)
A2.bet('DON', 25)
await A.until((s) => s.bets.DON === 125, 3)
A2.act('undo')
await A.until((s) => s.bets.DON === 100, 3)
ok('9b. bets and balance stay in sync across the two devices', A.state.bets.DON === 100 && A2.state.bets.DON === 100 && A.state.balance === 5875 && A2.state.balance === 5875)
ok('9c. another account still sees none of it', B.state.bets.DON === 0 && B.state.balance === 1990)
B.bet('DON', 10)
await sleep(200)
A.act('lock')
await B.until((s) => s.phase === 'SPINNING', 10)
// B's connection drops mid-spin and comes back; A closes one of two devices.
B.ws.close()
A.ws.close()
await sleep(600)
ok('one of two devices closing does not take the account offline', A2.state.room.players.find((p: State) => p.id === accA.id).connected === true
  && A2.state.room.players.find((p: State) => p.id === accB.id).connected === false && A2.state.room.hostId === accA.id)
await B.connect()
B.send({ t: 'join', code })
await B.until((s) => s.phase !== undefined && s.room.players.find((p: State) => p.id === accB.id).connected, 5)
ok('10a. reconnection restores the bet without duplicating it', B.state.bets.DON === 10 && B.state.balance === 1980)
for (const d of [A2, B, C]) await d.until((s) => s.phase === 'BONUS_ACTIVE', 45)
ok('same bonus opens for everyone', A2.state.bonus.kind === 'DON' && B.state.bonus.kind === 'DON' && JSON.stringify(A2.state.bonus) === JSON.stringify(C.state.bonus))
C.act('donFlip')
for (const d of [A2, B, C]) await d.until((s) => s.phase === 'BONUS_RESULT', 60)
const m: number = A2.state.bonusMultiplier
ok('same bonus outcome for everyone', B.state.bonusMultiplier === m && C.state.bonusMultiplier === m, `mult=${m}`)
ok('10b. rewards are paid once, each to its own wallet', A2.state.balance === 5875 + 100 * (m + 1) && B.state.balance === 1980 + 10 * (m + 1) && C.state.balance === 1000,
  `A=${A2.state.balance} B=${B.state.balance}`)

/* ── round 3: forced "1"; wallet floor ── */
for (const d of [A2, B, C]) await d.until((s) => s.phase === 'BETTING' && s.result === null, 30)
for (let i = 0; i < 12; i++) C.bet('10', 100)
await sleep(400)
ok('a wallet cannot go below zero', C.state.balance === 0 && C.state.bets['10'] === 1000 && C.errors.some((e) => e.includes('no Chaos Credits')))
A2.act('lock')
for (const d of [A2, B, C]) await d.until((s) => s.phase === 'RESULT', 40)
ok('losing stake is gone, others untouched', C.state.balance === 0 && B.state.balance === 1980 + 10 * (m + 1))
for (const d of [A2, B, C]) await d.until((s) => s.phase === 'BETTING' && s.result === null, 30)
C.act('topup')
await sleep(300)
ok('an empty wallet can be refilled to 1,000; a funded one cannot', C.state.balance === 1000 && (B.act('topup'), await sleep(200), B.state.balance === 1980 + 10 * (m + 1)))

/* ── statistics, history, leaderboard ── */
const meA = await getJson('/api/me', accA.token)
const meB = await getJson('/api/me', accB.token)
const meC = await getJson('/api/me', accC.token)
ok('wallet is stored per account on the server', meA.user.balance === A2.state.balance && meB.user.balance === B.state.balance)
ok('11a. statistics per account', meA.user.stats.games === 2 && meA.user.stats.victories === 2 && meA.user.stats.wagered === 325
  && meA.user.stats.net === 1200 + 100 * (m + 1) - 325 && meA.user.stats.biggestWin === 1200 && meA.user.stats.winPct === 100
  && meB.user.stats.games === 2 && meB.user.stats.victories === 1 && meB.user.stats.losses === 1 && meB.user.stats.winPct === 50
  && meC.user.stats.games === 1 && meC.user.stats.losses === 1 && meC.user.stats.net === -1000, JSON.stringify(meB.user.stats))
ok('history is private to the account', meB.history.length === 2 && meA.history.length === 2 && meC.history.length === 1)
const lb = await getJson('/api/leaderboard', accB.token)
ok('11b. leaderboards', lb.balance[0].id === accA.id && lb.balance[0].value === meA.user.balance && lb.net[0].id === accA.id
  && lb.net.at(-1).id === accC.id && lb.victories[0].id === accA.id && lb.victories[0].value === 2 && lb.winPct.length === 0,
  `balance top=${lb.balance[0].name} ${lb.balance[0].value}`)

server.kill()
await sleep(300)
for (const f of [DB_FILE, `${DB_FILE}-wal`, `${DB_FILE}-shm`]) rmSync(f, { force: true })
console.log(failed === 0 ? '\nAll multiplayer checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
