// The native files the ACP agent's npm package requires beside its bundles,
// one list for the packager (scripts/package-acp.mjs) and for every test that
// runs it over a test-owned source tree, so a fixture cannot lack a file the
// package copies (CIFIX017R3: three fixtures each kept a hand list, and one
// missed the launcher below).
import path from 'node:path'
import { VSIX_TARGETS } from './vsixTargets.mjs'

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
// One thin vault peer per Mac architecture (D209): the signed .apps ride
// beside these files, copied as bundles by scripts/package-acp.mjs (the
// universal package and the darwin targets). Arch names mirror
// src/shared/constants.ts (darwinVaultPeerFile).
export const DARWIN_PEERS = ['arm64', 'x64'].map((arch) =>
  path.join('native', 'darwin', `muse-vault-peer-${arch}`),
)
// The local judge's peer helper (M98 phase 2, src/runtime/judge/localHelper.ts):
// Windows and Linux ship its source and compile it on first judge use; macOS
// ships the CI-built universal binary (native/darwin/build-local-judge.sh).
export const JUDGE_PEER_SOURCES = [
  path.join('native', 'windows', 'MuseSparkLocalJudgePeer.cs'),
  path.join('native', 'linux', 'MuseSparkLocalJudgePeer.c'),
  path.join('native', 'darwin', 'muse-local-judge-peer'),
]
/** The judge peer pieces for one platform: sources where compiled on first use. */
function judgePeerFor(platform) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) return []
  const dir = platform === 'win32' ? 'windows' : platform
  return JUDGE_PEER_SOURCES.filter((file) => file.split(path.sep).includes(dir))
}
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

/**
The native sources the ACP package stages for a target: only that
platform's pieces, so a platform's package never demands a helper only
another OS builds. The runner ships everywhere (the SSH runner copies
the helper to the remote side, as in the .vsix). No argument is the
universal package, which keeps every platform's helpers.
*/
export function acpNativeFiles(target) {
  if (target === undefined)
    return [
      ...JOB_SOURCES,
      ...JUDGE_PEER_SOURCES,
      ...DARWIN_PEERS,
      ...LINUX_HELPERS,
      ...VOICE_WINDOWS_HELPERS,
    ]
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown ACP target: ${target}`)
  const [platform, arch] = target.split('-', 2)
  const linuxFiles = LINUX_HELPERS.filter((helper) => helper.split(path.sep).includes(arch))
  if (platform === 'linux') return [...linuxFiles, ...judgePeerFor(platform)]
  const darwinFiles = DARWIN_PEERS.filter((helper) =>
    helper.split(path.sep).at(-1).endsWith(`-${arch}`),
  )
  return platform === 'darwin'
    ? [...darwinFiles, ...judgePeerFor(platform)]
    : [...JOB_SOURCES, ...judgePeerFor(platform), ...VOICE_WINDOWS_HELPERS]
}
