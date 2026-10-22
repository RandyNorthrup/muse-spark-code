// Upgrades, channels and rollback (M110f lane O, D90.19): a newer
// candidate on the person's channel upgrades only past a ready
// readiness check, and a sick current install rolls back to the last
// good one. Versions compare numerically per segment; nothing here
// fetches, which is the channel transport's job once it lands.
import * as z from 'zod/mini'

export const nodeChannelSchema = z.enum(['stable', 'beta'])
export type NodeChannel = z.infer<typeof nodeChannelSchema>

export type NodeUpgradeDecision =
  | { readonly action: 'upgrade'; readonly to: string }
  | { readonly action: 'rollback'; readonly to: string }
  | { readonly action: 'hold'; readonly reason: string }

function versionParts(version: string): readonly number[] | undefined {
  return /^\d+(\.\d+)*$/.test(version) ? version.split('.').map(Number) : undefined
}

/** Negative when the left version is older, positive when newer. */
export function compareNodeVersions(left: string, right: string): number {
  const a = versionParts(left)
  const b = versionParts(right)
  if (a === undefined || b === undefined) throw new Error('node versions are dotted numbers')
  const width = Math.max(a.length, b.length)
  for (let index = 0; index < width; index += 1) {
    const delta = (a[index] ?? 0) - (b[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}

/* Upgrade past readiness, roll a sick install back, or hold with its reason. */
export function decideNodeUpgrade(options: {
  readonly channel: NodeChannel
  readonly current: string
  readonly currentHealth: 'good' | 'bad'
  readonly previous: string | undefined
  readonly candidate: string
  readonly candidateChannel: NodeChannel
  readonly readiness: { readonly ready: boolean; readonly reason?: string }
}): NodeUpgradeDecision {
  nodeChannelSchema.parse(options.channel)
  if (options.currentHealth === 'bad') {
    return options.previous === undefined
      ? { action: 'hold', reason: 'the install is sick and no previous version is kept' }
      : { action: 'rollback', to: options.previous }
  }
  if (options.candidateChannel !== options.channel)
    return { action: 'hold', reason: `no ${options.channel} release is newer` }
  if (compareNodeVersions(options.candidate, options.current) <= 0)
    return { action: 'hold', reason: 'the current version is the newest' }
  if (!options.readiness.ready)
    return {
      action: 'hold',
      reason: options.readiness.reason ?? 'readiness failed, the upgrade waits',
    }
  return { action: 'upgrade', to: options.candidate }
}
