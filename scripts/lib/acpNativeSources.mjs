// The native files the ACP agent's npm package requires beside its bundles,
// one list for the packager (scripts/package-acp.mjs) and for every test that
// runs it over a test-owned source tree, so a fixture cannot lack a file the
// package copies (CIFIX017R3: three fixtures each kept a hand list, and one
// missed the launcher below).
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
// The Windows free engine the packaged companion's file recognition starts
// (`src/runtime/companion/voiceEntry.ts` through `locateDictationHelper`):
// Windows PowerShell running this script on a staged WAV. The extension's
// own install carries it through `.vscodeignore`; the npm package must copy
// it too, or the certified route fails on an installed Windows agent.
export const VOICE_WINDOWS_HELPERS = [path.join('native', 'windows', 'dictate.ps1')]
// The governed runner's helper scripts, copied as a folder.
export const RUNNER_HELPERS = path.join('native', 'runner')
// The other CI systems' launcher (lane CM80CI-R2): the exact dependency
// closure of ci-entry.mjs (static and dynamic relative imports, resolved
// from action/lib) and the CI prompt directory it renders from, shipped as
// ci/lib and ci/prompts and run by ci-templates/ from the digest-pinned
// tarball as ci/lib/ci-entry.mjs. Unrelated Action entry points
// (checkout.mjs, gate.mjs, gate-cli.mjs, post.mjs) and the non-CI prompt
// pair (review.md, fix.md) stay out of the package. Each entry is an
// action/-rooted path; the packager preserves that relative path under ci/.
export const CI_LAUNCHER_SOURCES = [
  path.join('action', 'lib', 'ci-adapters.mjs'),
  path.join('action', 'lib', 'ci-entry.mjs'),
  path.join('action', 'lib', 'ci-files.mjs'),
  path.join('action', 'lib', 'ci-key.mjs'),
  path.join('action', 'lib', 'ci-run.mjs'),
  path.join('action', 'lib', 'git.mjs'),
  path.join('action', 'lib', 'inputs.mjs'),
  path.join('action', 'lib', 'install.mjs'),
  path.join('action', 'lib', 'lifecycle.mjs'),
  path.join('action', 'lib', 'result.mjs'),
  path.join('action', 'lib', 'run-exec.mjs'),
  path.join('action', 'lib', 'tools.mjs'),
  path.join('action', 'prompts', 'ci'),
]
