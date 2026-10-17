// The native files the ACP agent's npm package requires beside its bundles,
// one list for the packager (scripts/package-acp.mjs) and for every test that
// runs it over a test-owned source tree (test/unit/helpers/acpPackageSources.ts),
// so a fixture cannot lack a file the package copies (CIFIX017R3: three
// fixtures each kept a hand list, and one missed the launcher below).
import path from 'node:path'

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
  path.join('native', 'windows', 'MuseSparkJob.cs'),
  path.join('native', 'windows', 'MuseSparkMcpJob.cs'),
  path.join('native', 'windows', 'MuseSparkMcpLauncher.cs'),
  path.join('native', 'windows', 'MuseSparkScreenRecord.cs'),
]
export const DARWIN_HELPER = path.join('native', 'darwin', 'muse-dictate')
export const LINUX_HELPERS = ['x64', 'arm64'].map((arch) =>
  path.join('native', 'linux', arch, 'muse-created'),
)
// The governed runner's helper scripts, copied as a folder.
export const RUNNER_HELPERS = path.join('native', 'runner')
