// One .vsix per supported desktop target: the six targets the release
// ships, which native files each target's package keeps, and the artifact
// filename each is packed under. `native/runner/*` ships in every target
// because the SSH runner copies the helper to the remote side; everything
// not named below ships everywhere.
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

// The target a packed artifact was built for, from vsce's filename above;
// undefined for the old universal `<name>-<version>.vsix` name.
export function targetOfVsix(artifact) {
  const base = artifact.replaceAll('\\', '/').split('/').pop()
  const target = base?.match(/-([a-z]+\d*-[a-z0-9]+)-(\d+\.\d+\.\d+.*)\.vsix$/)?.[1]
  return VSIX_TARGETS.find((known) => known === target)
}

function platformOf(target) {
  return target.split('-', 1)[0]
}

function archOf(target) {
  return target.split('-', 2)[1]
}

/**
 * Whether the target's package keeps a repo-relative file. `file` is a
 * VSCE inventory path with any separator; comparison normalises to `/` so
 * the check holds on Windows checkouts too.
 */
export function isVsixTargetFile(target, file) {
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown VSIX target: ${target}`)
  const normalized = file.replaceAll('\\', '/')
  const platform = platformOf(target)
  if (normalized.startsWith('native/windows/')) return platform === 'win32'
  if (normalized.startsWith('native/darwin/')) return platform === 'darwin'
  if (normalized.startsWith('dist/native/darwin/')) return platform === 'darwin'
  const isForeignLinux =
    normalized.startsWith('native/linux/') &&
    (platform !== 'linux' || !normalized.startsWith(`native/linux/${archOf(target)}/`))
  return !isForeignLinux
}

// The native files a stage must still hold after filtering: the target's
// own helpers that live in git or are built before packaging. The darwin
// helpers are git-ignored CI builds, so a checkout without them still
// stages and the CI content check holds the shipped darwin entries.
// No argument is the universal stage, which keeps both Linux helpers.
const UNIVERSAL_REQUIRED_FILES = [
  'native/linux/x64/muse-created',
  'native/linux/arm64/muse-created',
]
const WINDOWS_REQUIRED_FILES = [
  'native/windows/dictate.ps1',
  'native/windows/MuseSparkVaultPipe.cs',
]

export function requiredNativeFiles(target) {
  if (target === undefined) return UNIVERSAL_REQUIRED_FILES
  if (!VSIX_TARGETS.includes(target)) throw new Error(`Unknown VSIX target: ${target}`)
  if (platformOf(target) === 'linux') return [`native/linux/${archOf(target)}/muse-created`]
  return platformOf(target) === 'win32' ? WINDOWS_REQUIRED_FILES : []
}
