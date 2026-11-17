import RAPIER from '@dimforge/rapier2d-compat'
import { GD_SLOTS } from '../logic/bonus'

/** Board dimensions, shared by the physics world and the renderer. */
export const BOARD = {
  halfW: 4,
  top: 10.6,
  slotH: 1.15,
  rows: 11,
  rowGap: 0.72,
  firstRowY: 2.05,
  ballR: 0.2,
  pinR: 0.075,
  slotW: 8 / GD_SLOTS,
} as const

/** Staggered pin field. Even rows (counted from the bottom) line up with the slot dividers. */
export function pinPositions(): [number, number][] {
  const out: [number, number][] = []
  for (let r = 0; r < BOARD.rows; r++) {
    const y = BOARD.firstRowY + r * BOARD.rowGap
    if (r % 2 === 0) for (let k = 1; k < GD_SLOTS; k++) out.push([-BOARD.halfW + k * BOARD.slotW, y])
    else for (let k = 1; k < GD_SLOTS - 1; k++) out.push([-BOARD.halfW + (k + 0.5) * BOARD.slotW, y])
  }
  return out
}

export const aimToX = (aim: number): number => (aim - 0.5) * 2 * (BOARD.halfW - 0.55)
export const slotCenterX = (slot: number): number => -BOARD.halfW + (slot + 0.5) * BOARD.slotW

let ready: Promise<void> | null = null
const initRapier = (): Promise<void> => (ready ??= RAPIER.init())

const STEP = 1 / 240

/**
 * A real rigid-body simulation (Rapier 2D). The prize is whichever slot the
 * ball physically ends up in — the game never decides it any other way.
 */
export class GravityBoard {
  private world: RAPIER.World
  private ball: RAPIER.RigidBody | null = null
  private acc = 0
  private stillFor = 0
  private nudges = 0
  private prevVx = 0
  private prevVy = 0
  x = 0
  y: number = BOARD.top
  /** Largest velocity change during the last `advance` call — used for collision sounds. */
  impact = 0
  landedSlot: number | null = null

  private constructor() {
    this.world = new RAPIER.World({ x: 0, y: -17 })
    this.world.timestep = STEP
    const fixed = (desc: RAPIER.ColliderDesc) => this.world.createCollider(desc.setRestitution(0.55).setFriction(0.05))
    for (const [x, y] of pinPositions()) fixed(RAPIER.ColliderDesc.ball(BOARD.pinR).setTranslation(x, y))
    fixed(RAPIER.ColliderDesc.cuboid(0.25, 7).setTranslation(-BOARD.halfW - 0.25, 6))
    fixed(RAPIER.ColliderDesc.cuboid(0.25, 7).setTranslation(BOARD.halfW + 0.25, 6))
    this.world.createCollider(RAPIER.ColliderDesc.cuboid(BOARD.halfW + 0.5, 0.25).setTranslation(0, -0.25).setRestitution(0.1).setFriction(0.8))
    for (let k = 1; k < GD_SLOTS; k++) {
      this.world.createCollider(
        RAPIER.ColliderDesc.cuboid(0.035, BOARD.slotH / 2).setTranslation(-BOARD.halfW + k * BOARD.slotW, BOARD.slotH / 2).setRestitution(0.3).setFriction(0.2),
      )
    }
  }

  static async create(): Promise<GravityBoard> {
    await initRapier()
    return new GravityBoard()
  }

  drop(x: number): void {
    if (this.ball) return
    this.ball = this.world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic().setTranslation(x, BOARD.top).setLinearDamping(0.05).setAngularDamping(0.3).setCcdEnabled(true),
    )
    this.world.createCollider(RAPIER.ColliderDesc.ball(BOARD.ballR).setRestitution(0.55).setFriction(0.05).setDensity(1.2), this.ball)
    this.x = x
    this.y = BOARD.top
  }

  /** Removes the ball so another one can be dropped (used after a DOUBLE). */
  reset(): void {
    if (this.ball) this.world.removeRigidBody(this.ball)
    this.ball = null
    this.landedSlot = null
    this.acc = 0
    this.stillFor = 0
    this.prevVx = 0
    this.prevVy = 0
    this.x = 0
    this.y = BOARD.top
  }

  get dropped(): boolean {
    return this.ball !== null
  }

  get speed(): number {
    return Math.hypot(this.prevVx, this.prevVy)
  }

  /** Advances the world by `dt` seconds of game time (pass a scaled dt for slow motion). */
  advance(dt: number): void {
    this.impact = 0
    const ball = this.ball
    if (!ball) return
    this.acc += Math.min(dt, 0.1)
    while (this.acc >= STEP) {
      this.acc -= STEP
      this.world.step()
      const v = ball.linvel()
      const dv = Math.hypot(v.x - this.prevVx, v.y - this.prevVy - this.world.gravity.y * STEP)
      if (dv > this.impact) this.impact = dv
      this.prevVx = v.x
      this.prevVy = v.y

      const p = ball.translation()
      const speed = Math.hypot(v.x, v.y)
      if (this.landedSlot === null) {
        if (p.y < BOARD.slotH * 0.6) {
          this.landedSlot = Math.max(0, Math.min(GD_SLOTS - 1, Math.floor((p.x + BOARD.halfW) / BOARD.slotW)))
        } else if (speed < 0.08) {
          // Perfectly balanced on a pin or divider: give it the faintest alternating tap.
          this.stillFor += STEP
          if (this.stillFor > 0.7) {
            this.stillFor = 0
            ball.applyImpulse({ x: (this.nudges++ % 2 === 0 ? 1 : -1) * 0.08, y: 0.02 }, true)
          }
        } else this.stillFor = 0
      }
    }
    const p = ball.translation()
    this.x = p.x
    this.y = p.y
  }

  free(): void {
    this.world.free()
  }
}
