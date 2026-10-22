/** M109's native helpers implement this port; terminal state never supplies a grant. */
export interface UserPresence {
  check(request: UserPresenceRequest): Promise<'approved' | 'denied' | 'unavailable'>
}
export interface UserPresenceRequest {
  readonly id: string
  readonly digest: string
  readonly machine: string
  readonly summary: string
}
