export type Phase =
  | 'IDLE'
  | 'BETTING'
  | 'LOCKED'
  | 'SPINNING'
  | 'DECELERATING'
  | 'RESULT'
  | 'BONUS_INTRO'
  | 'BONUS_ACTIVE'
  | 'BONUS_RESULT'
  | 'ROUND_COMPLETE'

/** Every legal transition. Anything not listed here is rejected by the store. */
export const TRANSITIONS: Record<Phase, readonly Phase[]> = {
  IDLE: ['BETTING'],
  BETTING: ['LOCKED'],
  LOCKED: ['SPINNING'],
  SPINNING: ['DECELERATING'],
  DECELERATING: ['RESULT'],
  RESULT: ['BONUS_INTRO', 'ROUND_COMPLETE'],
  BONUS_INTRO: ['BONUS_ACTIVE'],
  BONUS_ACTIVE: ['BONUS_RESULT'],
  BONUS_RESULT: ['ROUND_COMPLETE'],
  ROUND_COMPLETE: ['BETTING'],
}

export const canTransition = (from: Phase, to: Phase): boolean => TRANSITIONS[from].includes(to)

export const PHASE_LABEL: Record<Phase, string> = {
  IDLE: 'Welcome',
  BETTING: 'Place your selections',
  LOCKED: 'Selections closed',
  SPINNING: 'Wheel in motion',
  DECELERATING: 'Slowing down',
  RESULT: 'Result',
  BONUS_INTRO: 'Bonus unlocked',
  BONUS_ACTIVE: 'Bonus round',
  BONUS_RESULT: 'Bonus result',
  ROUND_COMPLETE: 'Next round',
}

/** Phase durations in seconds (phases not listed end on an event, not a timer). */
export const TIMING = {
  betting: 15,
  locked: 1.8,
  result: 3.4,
  bonusIntro: 3.6,
  bonusResult: 5.2,
  roundComplete: 2.0,
} as const
