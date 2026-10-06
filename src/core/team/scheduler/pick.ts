import { isResourceSlotAvailable, type TeamCapacityPort } from './slots'

/** Input is M96c's already eligible, fairly ordered local work; keep that order. */
export function pickResourceReady<T extends { readonly kind: 'worker' | 'check' }>(
  ordered: readonly T[],
  capacity: TeamCapacityPort,
): T | undefined {
  return ordered.find((task) => isResourceSlotAvailable(capacity, task.kind))
}
