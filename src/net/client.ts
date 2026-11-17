import { create } from 'zustand'
import { CM_SEG_ANGLE, type BonusState } from '../game/logic/bonus'
import type { SegmentType } from '../game/logic/segments'
import { simulateSpin, type SpinPlan } from '../game/physics/wheelSim'
import type { Phase } from '../game/state/machine'
import { useGame, type Bets } from '../game/state/store'

export interface NetUser {
  id: number
  name: string
  hasAvatar: boolean
  balance: number
  stats: { games: number; victories: number; losses: number; wagered: number; net: number; biggestWin: number; winPct: number }
}
export interface BoardRow { id: number; name: string; hasAvatar: boolean; games: number; value: number }
export interface Leaderboard { minGamesForPct: number; balance: BoardRow[]; net: BoardRow[]; victories: BoardRow[]; winPct: BoardRow[] }
export interface HistoryRow { room: string; round: number; result: SegmentType; multiplier: number; stake: number; win: number; at: number }
export interface RoomInfo {
  code: string
  hostId: number
  started: boolean
  players: { id: number; name: string; hasAvatar: boolean; connected: boolean }[]
}
interface PlanMsg { startAngle: number; omega0: number; elapsed: number }
interface StateMsg {
  t: 'state'; now: number; room: RoomInfo; phase: Phase; phaseAge: number; round: number; balance: number
  bets: Bets; bettingLeft: number; wheelAngle: number; spin: PlanMsg | null
  result: { index: number; type: SegmentType } | null; history: SegmentType[]; bonus: BonusState | null
  bonusSpin: PlanMsg | null; bonusMultiplier: number | null; lastWin: number
}

interface NetStore {
  /** null = not checked yet; false = the page is not being served by a game server. */
  serverOk: boolean | null
  info: { port: number; addresses: string[]; maxPlayers: number } | null
  token: string | null
  user: NetUser | null
  history: HistoryRow[]
  link: 'offline' | 'connecting' | 'online'
  room: RoomInfo | null
  leaderboard: Leaderboard | null
  error: string | null
  avatarVersion: number
}

const TOKEN_KEY = 'chaos.token'
const ROOM_KEY = 'chaos.room'
const read = (k: string, store: Storage): string | null => {
  try { return store.getItem(k) } catch { return null }
}
const write = (k: string, v: string | null, store: Storage): void => {
  try { if (v === null) store.removeItem(k); else store.setItem(k, v) } catch { /* storage unavailable */ }
}

export const useNet = create<NetStore>()(() => ({
  serverOk: null, info: null, token: read(TOKEN_KEY, localStorage), user: null, history: [],
  link: 'offline', room: null, leaderboard: null, error: null, avatarVersion: 0,
}))
const set = useNet.setState
const get = useNet.getState

let socket: WebSocket | null = null
let retry: number | null = null
let wantRoom: string | null = read(ROOM_KEY, sessionStorage)
const plans = new Map<string, SpinPlan>()

async function call<T>(path: string, body?: unknown): Promise<T> {
  const token = get().token
  const res = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status}).`)
  return data
}

const fail = (e: unknown) => set({ error: e instanceof Error ? e.message : String(e) })

/** Looks for the game server and restores a saved session. */
export async function initNet(): Promise<void> {
  try {
    const res = await fetch('/api/info')
    const info = (await res.json()) as NetStore['info'] & { ok?: boolean }
    if (!res.ok || !info?.ok) throw new Error('no server')
    set({ serverOk: true, info })
  } catch {
    set({ serverOk: false })
    return
  }
  if (get().token) {
    try {
      await refreshProfile()
      connect()
    } catch {
      write(TOKEN_KEY, null, localStorage)
      set({ token: null, user: null })
    }
  }
}

export async function refreshProfile(): Promise<void> {
  const me = await call<{ user: NetUser; history: HistoryRow[] }>('/api/me')
  set({ user: me.user, history: me.history })
}

export async function loadLeaderboard(): Promise<void> {
  try {
    set({ leaderboard: await call<Leaderboard>('/api/leaderboard') })
  } catch (e) {
    fail(e)
  }
}

export async function authenticate(mode: 'login' | 'register', username: string, password: string): Promise<void> {
  set({ error: null })
  try {
    const r = await call<{ token: string; user: NetUser }>(`/api/${mode}`, { username, password })
    write(TOKEN_KEY, r.token, localStorage)
    set({ token: r.token, user: r.user, history: [] })
    connect()
    void refreshProfile().catch(() => undefined)
  } catch (e) {
    fail(e)
  }
}

export async function logout(): Promise<void> {
  await call('/api/logout', {}).catch(() => undefined)
  write(TOKEN_KEY, null, localStorage)
  wantRoom = null
  write(ROOM_KEY, null, sessionStorage)
  socket?.close()
  set({ token: null, user: null, room: null, link: 'offline', history: [] })
}

/** Shrinks the chosen picture to a 128px square JPEG in the browser, then uploads it. */
export async function uploadAvatar(file: File): Promise<void> {
  set({ error: null })
  try {
    const bitmap = await createImageBitmap(file)
    const c = document.createElement('canvas')
    c.width = c.height = 128
    const side = Math.min(bitmap.width, bitmap.height)
    c.getContext('2d')!.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 128, 128)
    const r = await call<{ user: NetUser }>('/api/avatar', { image: c.toDataURL('image/jpeg', 0.85) })
    set((s) => ({ user: r.user, avatarVersion: s.avatarVersion + 1 }))
  } catch (e) {
    fail(e instanceof Error && e.name === 'InvalidStateError' ? new Error('That file is not an image.') : e)
  }
}

export const avatarUrl = (id: number): string => `/api/avatar/${id}?v=${get().avatarVersion}`

function connect(): void {
  const token = get().token
  if (!token || (socket && socket.readyState <= WebSocket.OPEN)) return
  set({ link: 'connecting' })
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?token=${token}`)
  socket = ws
  ws.onopen = () => {
    set({ link: 'online', error: null })
    if (wantRoom) ws.send(JSON.stringify({ t: 'join', code: wantRoom }))
  }
  ws.onmessage = (e) => {
    const msg = JSON.parse(String(e.data)) as StateMsg | { t: 'error'; message: string } | { t: 'left' }
    if (msg.t === 'state') applyState(msg)
    else if (msg.t === 'error') {
      set({ error: msg.message })
      if (!get().room) {
        wantRoom = null
        write(ROOM_KEY, null, sessionStorage)
      }
    }
  }
  ws.onclose = () => {
    if (socket !== ws) return
    socket = null
    set({ link: get().token ? 'connecting' : 'offline' })
    if (get().token && retry === null) {
      retry = window.setTimeout(() => {
        retry = null
        connect()
      }, 2000)
    }
  }
}

function send(msg: Record<string, unknown>): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg))
  else set({ error: 'Not connected to the server.' })
}

export function createRoom(): void {
  set({ error: null })
  send({ t: 'create' })
}
export function joinRoom(code: string): void {
  set({ error: null })
  wantRoom = code.trim().toUpperCase()
  send({ t: 'join', code: wantRoom })
}
export function startGame(): void {
  send({ t: 'start' })
}
/** Leaves the table and returns to a clean single-player page. */
export function leaveRoom(): void {
  send({ t: 'leave' })
  wantRoom = null
  write(ROOM_KEY, null, sessionStorage)
  window.setTimeout(() => location.reload(), 150)
}

function planFor(p: PlanMsg, seg?: number): SpinPlan {
  const key = `${p.startAngle}:${p.omega0}:${seg ?? 0}`
  let plan = plans.get(key)
  if (!plan) {
    // Same deterministic simulation the server ran, so the wheel lands exactly where the server says.
    plan = seg === undefined ? simulateSpin(p.startAngle, p.omega0) : simulateSpin(p.startAngle, p.omega0, seg)
    plans.clear()
    plans.set(key, plan)
  }
  return plan
}
const mainPlans = { key: '', plan: null as SpinPlan | null }

/** Mirrors the authoritative server state into the local store that the 3D scene and HUD read. */
function applyState(m: StateMsg): void {
  wantRoom = m.room.code
  write(ROOM_KEY, m.room.code, sessionStorage)
  set({ room: m.room, error: null })
  if (!m.room.started) return

  const now = performance.now()
  const offset = now - m.now
  const g = useGame.getState()
  let bonus = m.bonus
  if (bonus && (bonus.kind === 'TS' || bonus.kind === 'CM')) bonus = { ...bonus, pickEndsAt: bonus.pickEndsAt + offset }

  let spin: SpinPlan | null = null
  if (m.spin) {
    const key = `${m.spin.startAngle}:${m.spin.omega0}`
    if (mainPlans.key !== key) {
      mainPlans.key = key
      mainPlans.plan = simulateSpin(m.spin.startAngle, m.spin.omega0)
    }
    spin = mainPlans.plan
  }
  const inBonus = m.phase === 'BONUS_ACTIVE' || m.phase === 'BONUS_RESULT'
  const studioPhase = m.phase === 'BETTING' || m.phase === 'LOCKED' || m.phase === 'SPINNING' || m.phase === 'DECELERATING' || m.phase === 'RESULT'

  useGame.setState({
    mode: 'mp',
    send: (a) => send({ t: 'act', ...a }),
    ready: true,
    phase: m.phase,
    phaseStartedAt: m.phase === g.phase ? g.phaseStartedAt : now - m.phaseAge,
    round: m.round,
    balance: m.balance,
    bets: m.bets,
    bettingEndsAt: now + m.bettingLeft,
    wheelAngle: m.wheelAngle,
    spin,
    spinStartedAt: m.spin ? now - m.spin.elapsed : g.spinStartedAt,
    result: m.result,
    history: m.history,
    bonus,
    bonusSpin: m.bonusSpin ? planFor(m.bonusSpin, CM_SEG_ANGLE) : null,
    bonusSpinStartedAt: m.bonusSpin ? now - m.bonusSpin.elapsed : g.bonusSpinStartedAt,
    bonusMultiplier: m.bonusMultiplier,
    lastWin: m.lastWin,
    ...(inBonus && bonus && g.scene === 'studio' ? { scene: bonus.kind } : {}),
    ...(studioPhase && g.scene !== 'studio' ? { scene: 'studio' as const, curtain: false } : {}),
  })
}
