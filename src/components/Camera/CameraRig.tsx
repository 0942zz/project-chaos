import { useFrame, useThree } from '@react-three/fiber'
import { useRef } from 'react'
import * as THREE from 'three'
import { isBonus } from '../../game/logic/segments'
import { useGame, type GameStore } from '../../game/state/store'
import { damp } from '../../utils/math'

export interface Shot {
  pos: [number, number, number]
  target: [number, number, number]
  fov: number
  /** How quickly the camera travels to this shot. */
  speed?: number
}

const SHOTS = {
  front: { pos: [0, 3.3, 15.6], target: [0, 2.6, 0], fov: 38 },
  elevated: { pos: [-3.2, 7.4, 14.6], target: [0, 2.5, -1], fov: 38 },
  wheelClose: { pos: [0, 3.6, 9.4], target: [0, 3.3, -1.4], fov: 40 },
  pointer: { pos: [0.75, 5.9, 3.3], target: [0, 5.75, -1.3], fov: 36, speed: 1.5 },
  bonus: { pos: [-4.8, 1.5, 9], target: [0.6, 3.6, -1], fov: 44, speed: 2.4 },
  victory: { pos: [2.4, 2.6, 12.5], target: [0.8, 2.6, -0.5], fov: 40 },
} satisfies Record<string, Shot>

/** Picks the cinematic shot for the current moment of the round. */
function directShot(g: GameStore, now: number): Shot {
  switch (g.phase) {
    case 'IDLE': return SHOTS.elevated
    case 'BETTING': return SHOTS.front
    case 'LOCKED': return SHOTS.elevated
    case 'SPINNING': return SHOTS.wheelClose
    case 'DECELERATING': {
      const left = g.spin ? g.spin.duration - (now - g.spinStartedAt) / 1000 : 0
      return left < 3.6 ? SHOTS.pointer : SHOTS.wheelClose
    }
    case 'RESULT': {
      const age = (now - g.phaseStartedAt) / 1000
      if (age < 1.1) return SHOTS.pointer
      if (g.result && isBonus(g.result.type)) return SHOTS.bonus
      return g.lastWin > 0 ? SHOTS.victory : SHOTS.wheelClose
    }
    case 'BONUS_INTRO': return SHOTS.bonus
    default: return SHOTS.front
  }
}

const tmpPos = new THREE.Vector3()
const tmpTarget = new THREE.Vector3()

/** Smoothly flies the camera to a shot; pulls back automatically on narrow (portrait) screens. */
function useCameraMotion(getShot: (t: number) => Shot, drift = 0.12): void {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera
  const size = useThree((s) => s.size)
  const look = useRef<THREE.Vector3 | null>(null)
  useFrame(({ clock }, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const t = clock.elapsedTime
    const shot = getShot(t)
    const aspect = size.width / size.height
    const pull = aspect < 1.45 ? Math.pow(1.45 / aspect, 0.85) : 1
    tmpTarget.set(...shot.target)
    tmpPos.set(...shot.pos)
    if (aspect < 1) {
      // Portrait screens: keep the centrepiece in the middle of the frame.
      tmpTarget.x *= 0.25
      tmpPos.x *= 0.25
    }
    tmpPos.sub(tmpTarget).multiplyScalar(pull).add(tmpTarget)
    tmpPos.x += Math.sin(t * 0.23) * drift * 2.2
    tmpPos.y += Math.sin(t * 0.31) * drift
    if (!look.current) {
      look.current = tmpTarget.clone()
      camera.position.copy(tmpPos)
    }
    const k = 1 - Math.exp(-(shot.speed ?? 2) * dt)
    camera.position.lerp(tmpPos, k)
    look.current.lerp(tmpTarget, k * 1.25)
    camera.lookAt(look.current)
    const fov = damp(camera.fov, shot.fov, 2, dt)
    if (Math.abs(fov - camera.fov) > 0.001) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  })
}

export function CameraRig() {
  useCameraMotion(() => directShot(useGame.getState(), performance.now()))
  return null
}

/** Camera controller used by the bonus arenas. */
export function BonusCamera({ shot, drift = 0.08 }: { shot: (t: number) => Shot; drift?: number }) {
  useCameraMotion(shot, drift)
  return null
}
