// The native files the ACP agent's npm package requires beside its bundles,
// one list for the packager (scripts/package-acp.mjs) and for every test that
// runs it over a test-owned source tree, so a fixture cannot lack a file the
// package copies (CIFIX017R3: three fixtures each kept a hand list, and one
// missed the launcher below).
import path from 'node:path'
import process from 'node:process'

// The C# of the Windows job helpers, compiled on first use, as the extension
// ships it (PLAN.md D6): the shell tool's job (M27), the half both helpers
// share, and the governed launcher (MuseSparkMcpLauncher.cs). The runtime's
// resource governor starts every contained process through that launcher,
// `muse serve` included (src/runtime/resources/jobs.ts), so without it no
// session starts on Windows (CIFIX017W2).
export const JOB_SOURCES = [
  'native/windows/MuseSparkVault.cs',
  'native/windows/MuseSparkVaultCng.cs',
  'native/windows/MuseSparkVaultHello.cs',
  'native/windows/MuseSparkVaultLock.cs',
  'native/windows/MuseSparkVaultPipe.cs',
  path.join('native', 'windows', 'MuseSparkJob.cs'),
  path.join('native', 'windows', 'MuseSparkMcpJob.cs'),
  path.join('native', 'windows', 'MuseSparkMcpLauncher.cs'),
  path.join('native', 'windows', 'MuseSparkScreenRecord.cs'),
]
export const DARWIN_HELPER = path.join('native', 'darwin', 'muse-dictate')
export const LINUX_HELPERS = ['x64', 'arm64'].flatMap((arch) =>
  ['muse-created', 'muse-vault-peer'].map((helper) => path.join('native', 'linux', arch, helper)),
)
// The governed runner's helper scripts, copied as a folder.
export const RUNNER_HELPERS = path.join('native', 'runner')

// Which built helpers the packager requires on the machine it runs on.
// Like the per-platform .vsix (PLAN.md D123, scripts/lib/vsixTargets.mjs),
// each pack carries only its own platform's helpers: a helper only another
// OS builds is skipped with a warning when absent, while a helper this
// platform builds stays required — a missing one means its build step was
// skipped. CI composes every platform's helpers before packing and its
// content check still requires them all, so the release tarball stays
// complete; a locally packed tarball installed on another OS meets the
// runtime's honest missing-helper refusal there.
export function acpHelperPlan(platform = process.platform, arch = process.arch) {
  if (platform === 'darwin') return { required: [DARWIN_HELPER], optional: [...LINUX_HELPERS] }
  if (platform === 'linux') {
    const required = LINUX_HELPERS.filter((helper) => helper.split(path.sep).includes(arch))
    if (required.length === 0) throw new Error(`Unknown ACP packager architecture: ${arch}`)
    const optional = [
      DARWIN_HELPER,
      ...LINUX_HELPERS.filter((helper) => !required.includes(helper)),
    ]
    return { required, optional }
  }
  if (platform === 'win32') return { required: [], optional: [DARWIN_HELPER, ...LINUX_HELPERS] }
  throw new Error(`Unknown ACP packager platform: ${platform}`)
}
