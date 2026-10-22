import { identifyBoard, type BoardFamily, type SerialIdentity } from './serial/identity'

export interface FlashTarget {
  readonly platformioBoard?: string
  readonly idfTarget?: string
  readonly fqbn?: string
  /** Detection may supply a verified family for a board not in the small table. */
  readonly family?: BoardFamily
}

/** A bridge or ambiguous board is unknown, rather than a fabricated match. */
export function checkFlashIdentity(
  identity: SerialIdentity,
  target: FlashTarget,
): {
  readonly status: 'match' | 'mismatch' | 'unknown'
  readonly deviceFamily: BoardFamily | undefined
  readonly targetFamily: BoardFamily | undefined
} {
  const deviceFamily = identifyBoard(identity).family
  const names = [target.platformioBoard, target.idfTarget, target.fqbn].filter(
    (value) => value !== undefined,
  )
  const families = new Set<BoardFamily>()
  if (target.family !== undefined) families.add(target.family)
  for (const name of names) {
    if (/(?:^|[:_-])esp32(?:[a-z\d_-]*)(?:$|:)/i.test(name)) families.add('esp32')
    if (/(?:^|[:_-])(?:rp2040|pico)(?:$|:)/i.test(name)) families.add('rp2040')
    if (/(?:^|[:_-])(?:rp2350|pico2)(?:$|:)/i.test(name)) families.add('rp2350')
    if (/^arduino:avr:/i.test(name)) families.add('avr')
  }
  const targetFamily = families.size === 1 ? [...families][0] : undefined
  let status: 'match' | 'mismatch' | 'unknown' = 'unknown'
  if (deviceFamily !== undefined && targetFamily !== undefined) {
    status = deviceFamily === targetFamily ? 'match' : 'mismatch'
    // Shared Pico firmware IDs prove a non-ESP board, but not its chip generation.
    if (deviceFamily === 'rp2' && (targetFamily === 'rp2040' || targetFamily === 'rp2350'))
      status = 'unknown'
  }
  return {
    status,
    deviceFamily,
    targetFamily,
  }
}
