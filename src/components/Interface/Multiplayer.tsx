import { useEffect, useRef, useState } from 'react'
import { SEGMENTS } from '../../game/logic/segments'
import { useGame } from '../../game/state/store'
import {
  authenticate, avatarUrl, createRoom, joinRoom, leaveRoom, loadLeaderboard, logout, refreshProfile, startGame, uploadAvatar, useNet,
  type BoardRow,
} from '../../net/client'
import { formatCredits, formatMult } from '../../utils/math'

export function Avatar({ id, name, has, size = 36 }: { id: number; name: string; has: boolean; size?: number }) {
  useNet((s) => s.avatarVersion)
  return has ? (
    <img className="avatar" src={avatarUrl(id)} alt="" width={size} height={size} />
  ) : (
    <span className="avatar blank" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>
      {name.slice(0, 1).toUpperCase()}
    </span>
  )
}

function AuthForm() {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    await authenticate(mode, username, password)
    setBusy(false)
  }
  return (
    <form className="form" onSubmit={submit}>
      <div className="seg two">
        <button type="button" className={mode === 'login' ? 'on' : ''} onClick={() => setMode('login')}>Sign in</button>
        <button type="button" className={mode === 'register' ? 'on' : ''} onClick={() => setMode('register')}>New account</button>
      </div>
      <label>
        <span>Username</span>
        <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" maxLength={16} required />
      </label>
      <label>
        <span>Password</span>
        <input
          type="password" value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={6} required
        />
      </label>
      <button className="btn-primary" disabled={busy}>{mode === 'login' ? 'Sign in' : 'Create account'}</button>
      <p className="menu-note">Accounts live only on the host PC. Passwords are stored hashed.</p>
    </form>
  )
}

function Profile() {
  const user = useNet((s) => s.user)!
  const history = useNet((s) => s.history)
  const file = useRef<HTMLInputElement>(null)
  // Wallet and statistics live on the server; fetch the current values whenever the profile is shown.
  useEffect(() => { void refreshProfile().catch(() => undefined) }, [])
  return (
    <>
      <div className="profile">
        <Avatar id={user.id} name={user.name} has={user.hasAvatar} size={64} />
        <div>
          <strong>{user.name}</strong>
          <small>Player #{user.id}</small>
          <div className="profile-actions">
            <button className="btn-ghost" onClick={() => file.current?.click()}>Change avatar</button>
            <button className="btn-ghost" onClick={() => void logout()}>Sign out</button>
          </div>
          <input
            ref={file} type="file" accept="image/*" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadAvatar(f); e.target.value = '' }}
          />
        </div>
      </div>
      <dl className="stats">
        <div><dt>Balance</dt><dd className="gold">{formatCredits(user.balance)}</dd></div>
        <div><dt>Games</dt><dd>{user.stats.games}</dd></div>
        <div><dt>Won</dt><dd>{user.stats.victories}</dd></div>
        <div><dt>Lost</dt><dd>{user.stats.losses}</dd></div>
        <div><dt>Wagered</dt><dd>{formatCredits(user.stats.wagered)}</dd></div>
        <div><dt>Net</dt><dd className={user.stats.net < 0 ? 'neg' : ''}>{user.stats.net > 0 ? '+' : ''}{formatCredits(user.stats.net)}</dd></div>
        <div><dt>Biggest win</dt><dd>{formatCredits(user.stats.biggestWin)}</dd></div>
        <div><dt>Win rate</dt><dd>{user.stats.games ? `${user.stats.winPct}%` : '—'}</dd></div>
      </dl>
      {history.length > 0 && (
        <table className="odds compact">
          <thead><tr><th>Room · round</th><th>Result</th><th>Stake</th><th>Return</th></tr></thead>
          <tbody>
            {history.slice(0, 6).map((h, i) => (
              <tr key={i}>
                <td>{h.room} · {h.round}</td>
                <td>{SEGMENTS[h.result]?.name ?? h.result}</td>
                <td>{formatCredits(h.stake)}</td>
                <td>{formatCredits(h.win)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}

function Lobby({ onGesture }: { onGesture: () => void }) {
  const room = useNet((s) => s.room)!
  const user = useNet((s) => s.user)!
  const info = useNet((s) => s.info)
  const isHost = room.hostId === user.id
  const address = info?.addresses[0] ? `http://${info.addresses[0]}:${info.port}` : location.origin
  return (
    <>
      <div className="room-code">
        <small>Room code</small>
        <strong>{room.code}</strong>
      </div>
      <p className="menu-note">
        Others on the same network open <b>{address}</b> in a browser, sign in and join with this code.
      </p>
      <ul className="players">
        {room.players.map((p) => (
          <li key={p.id} className={p.connected ? '' : 'away'}>
            <Avatar id={p.id} name={p.name} has={p.hasAvatar} />
            <span>{p.name}</span>
            {p.id === room.hostId && <em>Host</em>}
            {!p.connected && <em>Reconnecting</em>}
          </li>
        ))}
      </ul>
      <p className="menu-note">{room.players.length} of {info?.maxPlayers ?? 8} players · everyone plays with their own wallet and private bets</p>
      <div className="form-row">
        {isHost ? (
          <button className="btn-primary" onClick={() => { onGesture(); startGame() }}>Start the show</button>
        ) : (
          <span className="waiting">Waiting for the host to start…</span>
        )}
        <button className="btn-ghost" onClick={leaveRoom}>Leave room</button>
      </div>
    </>
  )
}

function Rooms({ onGesture }: { onGesture: () => void }) {
  const [code, setCode] = useState('')
  const link = useNet((s) => s.link)
  const online = link === 'online'
  return (
    <div className="rooms">
      <button className="btn-primary" disabled={!online} onClick={() => { onGesture(); createRoom() }}>Create room</button>
      <form className="form-row" onSubmit={(e) => { e.preventDefault(); onGesture(); joinRoom(code) }}>
        <input
          className="code-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))}
          placeholder="CODE" maxLength={4} aria-label="Room code" required
        />
        <button className="btn-ghost" disabled={!online || code.length !== 4}>Join room</button>
      </form>
      {!online && <p className="menu-note">Connecting to the server…</p>}
    </div>
  )
}

function Board({ title, rows, format, note }: { title: string; rows: BoardRow[]; format: (v: number) => string; note?: string }) {
  const me = useNet((s) => s.user?.id)
  return (
    <section className="board-list">
      <h3>{title}</h3>
      {rows.length === 0 ? (
        <p className="menu-note">{note ?? 'No rounds played yet.'}</p>
      ) : (
        <ol>
          {rows.map((r, i) => (
            <li key={r.id} className={r.id === me ? 'me' : ''}>
              <b>{i + 1}</b>
              <Avatar id={r.id} name={r.name} has={r.hasAvatar} size={22} />
              <span>{r.name}</span>
              <em>{format(r.value)}</em>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function Leaderboards() {
  const lb = useNet((s) => s.leaderboard)
  useEffect(() => { void loadLeaderboard() }, [])
  if (!lb) return <p className="menu-note">Loading the leaderboard…</p>
  const signed = (v: number) => `${v > 0 ? '+' : ''}${formatCredits(v)}`
  return (
    <div className="boards">
      <Board title="Highest balance" rows={lb.balance} format={formatCredits} />
      <Board title="Highest net winnings" rows={lb.net} format={signed} />
      <Board title="Most victories" rows={lb.victories} format={String} />
      <Board title="Best win rate" rows={lb.winPct} format={(v) => `${v}%`} note={`Needs at least ${lb.minGamesForPct} rounds played.`} />
    </div>
  )
}

/** The multiplayer section of the main menu: account, profile, rooms and lobby. */
export function MultiplayerPanel({ onGesture }: { onGesture: () => void }) {
  const serverOk = useNet((s) => s.serverOk)
  const user = useNet((s) => s.user)
  const room = useNet((s) => s.room)
  const error = useNet((s) => s.error)
  const [tab, setTab] = useState<'play' | 'ranks'>('play')
  return (
    <div className="menu-panel">
      <h2>{room ? 'Lobby' : 'Multiplayer · LAN'}</h2>
      {serverOk && user && !room && (
        <div className="seg two tabs">
          <button className={tab === 'play' ? 'on' : ''} onClick={() => setTab('play')}>Profile & rooms</button>
          <button className={tab === 'ranks' ? 'on' : ''} onClick={() => setTab('ranks')}>Leaderboard</button>
        </div>
      )}
      {serverOk === null && <p className="menu-note">Looking for the game server…</p>}
      {serverOk === false && (
        <p className="menu-note">
          Multiplayer needs the game server. On the host PC run <b>bun run start</b>, then open the address it prints
          (for example http://192.168.1.20:3000) instead of this page.
        </p>
      )}
      {serverOk && !user && <AuthForm />}
      {serverOk && user && !room && tab === 'play' && (
        <>
          <Profile />
          <Rooms onGesture={onGesture} />
        </>
      )}
      {serverOk && user && !room && tab === 'ranks' && <Leaderboards />}
      {serverOk && user && room && <Lobby onGesture={onGesture} />}
      {error && <p className="form-error" role="alert">{error}</p>}
    </div>
  )
}

/** In-game roster for a multiplayer table. */
export function PlayersStrip() {
  const mp = useGame((s) => s.mode === 'mp')
  const room = useNet((s) => s.room)
  const link = useNet((s) => s.link)
  if (!mp || !room) return null
  return (
    <aside className="roster" aria-label="Players">
      <div className="roster-head">
        <span>Room {room.code}</span>
        <i className={link === 'online' ? 'ok' : 'bad'}>{link === 'online' ? 'Live' : 'Reconnecting…'}</i>
      </div>
      {room.players.map((p) => (
        <div key={p.id} className={`roster-row ${p.connected ? '' : 'away'}`}>
          <Avatar id={p.id} name={p.name} has={p.hasAvatar} size={26} />
          <span>{p.name}</span>
          {p.id === room.hostId && <em>Host</em>}
        </div>
      ))}
      <button className="btn-ghost" onClick={leaveRoom}>Leave</button>
    </aside>
  )
}
