import { useRef, useState } from 'react'
import { SEGMENTS } from '../../game/logic/segments'
import { useGame } from '../../game/state/store'
import {
  authenticate, avatarUrl, createRoom, joinRoom, leaveRoom, logout, startGame, uploadAvatar, useNet,
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
        <div><dt>Rounds</dt><dd>{user.stats.rounds}</dd></div>
        <div><dt>Staked</dt><dd>{formatCredits(user.stats.staked)}</dd></div>
        <div><dt>Returned</dt><dd>{formatCredits(user.stats.won)}</dd></div>
        <div><dt>Best hit</dt><dd>{user.stats.best ? formatMult(user.stats.best) : '—'}</dd></div>
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
      <p className="menu-note">{room.players.length} of {info?.maxPlayers ?? 8} players · one shared wallet of 1,000 Chaos Credits</p>
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

/** The multiplayer section of the main menu: account, profile, rooms and lobby. */
export function MultiplayerPanel({ onGesture }: { onGesture: () => void }) {
  const serverOk = useNet((s) => s.serverOk)
  const user = useNet((s) => s.user)
  const room = useNet((s) => s.room)
  const error = useNet((s) => s.error)
  return (
    <div className="menu-panel">
      <h2>{room ? 'Lobby' : 'Multiplayer · LAN'}</h2>
      {serverOk === null && <p className="menu-note">Looking for the game server…</p>}
      {serverOk === false && (
        <p className="menu-note">
          Multiplayer needs the game server. On the host PC run <b>bun run start</b>, then open the address it prints
          (for example http://192.168.1.20:3000) instead of this page.
        </p>
      )}
      {serverOk && !user && <AuthForm />}
      {serverOk && user && !room && (
        <>
          <Profile />
          <Rooms onGesture={onGesture} />
        </>
      )}
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
