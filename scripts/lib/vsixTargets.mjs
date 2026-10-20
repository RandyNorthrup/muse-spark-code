// One .vsix per supported desktop target (PLAN.md D209): the six targets
// the release ships, which native files each target's package keeps, and
// the artifact filename each is packed under. `native/runner/*` ships in
// every target because the SSH runner copies the helper to the remote
// side; everything not named below ships everywhere. Beside the six, the
// release ships the untargeted fallback package (no `--target`): VS Code
// serves it as the fallback on every platform without its own package, so
// Alpine (`alpine-x64`, `alpine-arm64`) and `linux-armhf` servers —
// `extensionKind: ["workspace"]`, so a Dev Container or Remote SSH window
// installs the extension on the server — keep installing exactly what they
// ran before. The fallback only ever reaches Linux-family platforms, so it
// carries the platform-neutral content plus the Linux helpers only, never
// the darwin or Windows pieces, and meets the same budget.
export const VSIX_TARGETS = [
  'win32-x64',
  'win32-arm64',
  'darwin-x64',
  'darwin-arm64',
  'linux-x64',
  'linux-arm64',
]

// The `--target` value of a packager command line, or undefined when the
// flag is absent (the universal package). A present flag without a known
// target — including a missing value — throws instead of silently packing
// the wrong package.
export function targetFromArgs(argv) {
  const index = argv.indexOf('--target')
  if (index === -1) return
  const target = argv[index + 1]
  if (target === undefined || !VSIX_TARGETS.includes(target))
    throw new Error(`Unknown VSIX target: ${target}. Valid targets: ${VSIX_TARGETS.join(', ')}`)
  return target
}

// vsce's own filename for a targeted package:
// `<name>-<target>-<version>.vsix` (node_modules/@vscode/vsce/out/package.js).
export function vsixArtifactName(name, version, target) {
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown VSIX target: ${target}`)
  return `${name}-${target}-${version}.vsix`
}

// vsce's own filename for the untargeted universal package:
// `<name>-<version>.vsix`. The release ships it beside the six targeted
// packages as the fallback for platforms without their own target.
export function vsixFallbackName(name, version) {
  return `${name}-${version}.vsix`
}

// The target a packed artifact was built for, from vsce's filename above;
// undefined for the old universal `<name>-<version>.vsix` name.
export function targetOfVsix(artifact) {
  const base = artifact.replaceAll('\\', '/').split('/').pop()
  const target = base?.match(/-([a-z]+\d*-[a-z0-9]+)-(\d+\.\d+\.\d+.*)\.vsix$/)?.[1]
  return VSIX_TARGETS.find((known) => known === target)
}

// The release's published VSIX inventory: one artifact per target plus
// the untargeted fallback. The release receipt and verifier share this
// list, so the packages job checks exactly what the release publishes.
export function vsixReleaseAssets(name, version) {
  return [
    ...VSIX_TARGETS.map((target) => vsixArtifactName(name, version, target)),
    vsixFallbackName(name, version),
  ]
}

function platformOf(target) {
  return target.split('-', 1)[0]
}

function archOf(target) {
  return target.split('-', 2)[1]
}

/**
Whether a target's package keeps a repo-relative file. `file` is a
VSCE inventory path with any separator; comparison normalises to `/` so
the check holds on Windows checkouts too. No target is the untargeted
fallback package: the platform-neutral content plus the Linux helpers
(both arches, as `requiredNativeFiles` demands), never the darwin or
Windows pieces. VS Code serves the fallback only where no targeted
package exists (Linux-family servers), so the other platforms' helpers
would only spend the shared budget.
*/
export function isVsixTargetFile(target, file) {
  const normalized = file.replaceAll('\\', '/')
  if (target === undefined)
    return (
      !normalized.startsWith('native/windows/') &&
      !normalized.startsWith('native/darwin/') &&
      !normalized.startsWith('dist/native/darwin/')
    )
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown VSIX target: ${target}`)
  const platform = platformOf(target)
  if (normalized.startsWith('native/windows/')) return platform === 'win32'
  if (normalized.startsWith('native/darwin/') || normalized.startsWith('dist/native/darwin/')) {
    if (platform !== 'darwin') return false
    // One thin binary per Mac architecture (D209): a darwin target ships
    // only its own architecture's slices (`-arm64` or `-x64`).
    const arch = archOf(target)
    return normalized.includes(`-${arch}.app/`) || normalized.endsWith(`-${arch}`)
  }
  const isForeignLinux =
    normalized.startsWith('native/linux/') &&
    (platform !== 'linux' || !normalized.startsWith(`native/linux/${archOf(target)}/`))
  return !isForeignLinux
}

// The native files a stage must still hold after filtering: the target's
// own helpers that live in git or are built before packaging. The darwin
// helpers are git-ignored CI builds, so a checkout without them still
// stages and the CI content check holds the shipped darwin entries.
// No argument is the fallback stage, which keeps both Linux helpers.
const UNIVERSAL_REQUIRED_FILES = [
  'native/linux/x64/muse-created',
  'native/linux/arm64/muse-created',
]
// The slot helper compiles its four sources as one unit at first vault
// use; all four must stage, not only the pipe source.
const WINDOWS_REQUIRED_FILES = [
  'native/windows/dictate.ps1',
  'native/windows/MuseSparkVault.cs',
  'native/windows/MuseSparkVaultCng.cs',
  'native/windows/MuseSparkVaultHello.cs',
  'native/windows/MuseSparkVaultLock.cs',
  'native/windows/MuseSparkVaultPipe.cs',
]

export function requiredNativeFiles(target) {
  if (target === undefined) return UNIVERSAL_REQUIRED_FILES
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown VSIX target: ${target}`)
  if (platformOf(target) === 'linux') return [`native/linux/${archOf(target)}/muse-created`]
  return platformOf(target) === 'win32' ? WINDOWS_REQUIRED_FILES : []
}
