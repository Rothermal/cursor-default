export type BonusStatus = 'none' | 'one_and_one' | 'double_bonus'

export function getBonusStatus(
  foulCount: number,
  bonusThreshold: number,
  doubleBonusThreshold: number,
  hasOneAndOne: boolean
): BonusStatus {
  if (foulCount >= doubleBonusThreshold) {
    return 'double_bonus'
  }
  if (hasOneAndOne && foulCount >= bonusThreshold) {
    return 'one_and_one'
  }
  if (!hasOneAndOne && foulCount >= bonusThreshold) {
    return 'double_bonus'
  }
  return 'none'
}
