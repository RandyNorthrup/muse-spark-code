// What a panel sends its window's playbook, for the suites that speak the
// panel's channel to a handler or to the shipped bundle (M116, C-M116-6).

/** A bridge id of the shape the panel mints. */
export const PANEL_BRIDGE = `${'A'.repeat(22)}==`

export const OFFLOAD_REASON = 'one machine here'

/** The panel turning the offload rule off, with the reason a person gave. */
export function offloadOffRequest(workspaceId: string | undefined, requestId: number) {
  return {
    type: 'playbookChange',
    bridgeId: PANEL_BRIDGE,
    workspaceId,
    requestId,
    change: { rule: 'offload', enabled: false, reason: OFFLOAD_REASON },
  }
}
