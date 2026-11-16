import { createRng } from '../probability/rng'

/**
 * One RNG per session. Pass `?seed=1234` in the URL to replay an identical
 * sequence of spins and bonus outcomes (given identical player choices).
 */
const params = new URLSearchParams(typeof location !== 'undefined' ? location.search : '')
const seedParam = params.get('seed')

export const SESSION_SEED: number =
  seedParam !== null && Number.isFinite(Number(seedParam))
    ? Number(seedParam) >>> 0
    : (crypto.getRandomValues(new Uint32Array(1))[0] >>> 0)

export const rng = createRng(SESSION_SEED)
export const DEV_MODE = params.has('dev')
export const FAST_MODE = params.has('fast')
