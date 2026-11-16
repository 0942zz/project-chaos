/** Warm the bonus chunks in the background once the studio is on screen. */
export function preloadBonusGames(): void {
  void import('./BonusGames/DoubleOrNothing')
  void import('./BonusGames/TreasureStorm')
  void import('./BonusGames/GravityDrop')
  void import('./BonusGames/ChaosMode')
}
