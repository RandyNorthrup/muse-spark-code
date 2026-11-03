import { spawnSync } from 'node:child_process'

/** The processor a Mac's other helper build is made for. */
export const OTHER_PROCESSOR = process.arch === 'arm64' ? 'x64' : 'arm64'

/**
Whether this Mac runs a program built for the other processor. An Intel Mac
never runs an arm64 build; an Apple silicon Mac runs an x64 build whenever
Rosetta is installed (hosted macOS runners have it), so there the other
build starts and answers for itself, and no start fault can be shown with it.
Asked of the system: `arch -x86_64` starts a system program translated, or
fails when Rosetta is absent.
*/
export function canRunOtherProcessor(): boolean {
  return (
    process.platform === 'darwin' &&
    process.arch === 'arm64' &&
    spawnSync('/usr/bin/arch', ['-x86_64', '/usr/bin/true'], { stdio: 'ignore' }).status === 0
  )
}
