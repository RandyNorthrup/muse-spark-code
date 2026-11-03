// Whether this run may touch a real Muse Code. A suite never starts a developer's or a rig's
// CLI, or runs Meta's installer, because it happens to find one: its sessions and its self-update
// are theirs. Only a run that names this variable does, as the hosted test job does on a runner
// that holds nobody's Muse.

export const REAL_MUSE_VARIABLE = 'MUSE_TEST_REAL_CLI'

export function isRealMuseAsked(): boolean {
  return process.env[REAL_MUSE_VARIABLE] === '1'
}
