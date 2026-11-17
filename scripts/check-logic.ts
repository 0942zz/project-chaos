/**
 * Headless checks for the rules that are hard to hit by hand.
 *   bun run scripts/check-logic.ts
 */
import {
  CM_DOUBLE, CM_MAX_BOOSTS, CM_SEG_ANGLE, CM_TRIPLE, GD_DOUBLE, GD_MAX_DOUBLES,
  cmBeginSpin, cmLand, cmPick, cmSegmentAt, createCm, createDon, createGd, createTs,
  donFlip, donLand, gdDrop, gdLand, gdRearm, tsPick,
} from '../src/game/logic/bonus'
import { SEGMENTS, WHEEL, WHEEL_COUNTS, indexAtAngle, isBonus } from '../src/game/logic/segments'
import { planFreeSpin, planSpin } from '../src/game/physics/wheelSim'
import { createRng } from '../src/game/probability/rng'

let failed = 0
const ok = (name: string, cond: boolean, extra = '') => {
  if (!cond) failed++
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
}
const rng = createRng(12345)

// main wheel: layout, and result always equals the pocket at the resting angle
const counts: Record<string, number> = {}
WHEEL.forEach((t) => (counts[t] = (counts[t] ?? 0) + 1))
ok('wheel pocket counts', Object.entries(WHEEL_COUNTS).every(([t, n]) => counts[t] === n))
ok('bonus pockets never adjacent (circular)', WHEEL.every((t, i) => !(isBonus(t) && isBonus(WHEEL[(i + 1) % WHEEL.length]))))
let consistent = true
const hits: Record<string, number> = {}
for (let i = 0; i < 400; i++) {
  const p = planSpin(rng, rng.range(0, 6.28))
  if (p.finalIndex !== indexAtAngle(p.finalAngle) || p.finalType !== WHEEL[p.finalIndex]) consistent = false
  hits[p.finalType] = (hits[p.finalType] ?? 0) + 1
}
ok('400 spins: result == pocket under pointer', consistent, JSON.stringify(hits))
ok('forced spin lands on requested type', planSpin(rng, 1, 'CM').finalType === 'CM')

// DOUBLE
let don = donLand(donFlip(createDon(rng), rng))
ok('coin pays the face that landed', don.multiplier === (don.outcome === 'SUN' ? don.sun : don.moon) && don.sun !== don.moon)

// TREASURE
const ts0 = createTs(rng)
ok('target wall: no pick before the pick phase', tsPick(ts0, 3) === ts0)
const ts1 = tsPick({ ...ts0, status: 'pick' }, 7)
ok('target wall: pays the chosen target', ts1.multiplier === ts0.values[7] && tsPick(ts1, 8) === ts1)

// GRAVITY: DOUBLE doubles every slot and re-arms; capped
let gd = gdDrop(createGd(rng), rng)
const before = gd.slots.slice()
const di = gd.slots.indexOf(GD_DOUBLE)
gd = gdLand(gd, di)
ok('pin board: DOUBLE doubles all slots', gd.status === 'doubling' && gd.slots.every((v, i) => v === before[i] * 2))
gd = gdRearm(gd)
ok('pin board: re-armed after DOUBLE', gd.status === 'aim')
for (let n = 1; n < GD_MAX_DOUBLES; n++) gd = gdRearm(gdLand(gdDrop(gd, rng), gd.slots.indexOf(GD_DOUBLE)))
ok('pin board: DOUBLE slots removed after the cap', !gd.slots.includes(GD_DOUBLE) && gd.doubles === GD_MAX_DOUBLES)
gd = gdLand(gdDrop(gd, rng), 4)
ok('pin board: multiplier slot pays', gd.status === 'landed' && gd.multiplier === gd.slots[4] && gdLand(gd, 1) === gd)

// CHAOS: result from resting angle; boosts multiply the wheel and respin; capped
let cm = cmPick(createCm(rng, 0), 2)
ok('grand wheel: second pick ignored', cmPick(cm, 0) === cm)
let boosted = 0
let agree = true
for (let game = 0; game < 60; game++) {
 cm = cmPick(createCm(rng, 0), 2)
 for (let i = 0; i < 300 && cm.stage !== 'result'; i++) {
  cm = cmBeginSpin(cm)
  const plan = planFreeSpin(rng, cm.angle, CM_SEG_ANGLE)
  const seg = cmSegmentAt(plan.finalAngle, 2)
  const value = cm.wheel[seg]
  const prev = cm.wheel.slice()
  cm = cmLand(cm, plan.finalAngle)
  if (cm.landed?.[2] !== seg) agree = false
  if (value === CM_DOUBLE || value === CM_TRIPLE) {
    boosted++
    const f = -value
    if (!prev.every((v, k) => v < 0 || cm.wheel[k] === Math.min(v * f, 10000))) agree = false
    if (cm.stage !== 'boost') agree = false
  } else if (cm.multiplier !== value) agree = false
 }
 if (cm.stage !== 'result' || cm.boosts > CM_MAX_BOOSTS) agree = false
}
ok('grand wheel: 60 games pay the segment under the chosen pointer, boosts multiply the wheel', agree && boosted > 0, `boost spins=${boosted}`)
ok('grand wheel: boosts are capped', cm.boosts <= CM_MAX_BOOSTS)

ok('payout table present for numbers', (['1', '2', '5', '10'] as const).every((t) => SEGMENTS[t].payout === Number(t)))
console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`)
process.exit(failed === 0 ? 0 : 1)
