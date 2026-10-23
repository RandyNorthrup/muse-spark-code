// M110os OS5: the add-on manifest check. Every addon.json declares what
// the add-on is, which OS release it matches, where it builds, and where
// its bits come from; the tree check compares a built extension tree's
// extension-release file against the manifest. Node builtins only, so the
// device and CI run it bare.
import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { parseFingerprintsFile } from './fingerprints.mjs'

const MANIFEST_KEYS = new Set([
  'name',
  'kind',
  'architectures',
  'vendor',
  'terms',
  'install',
  'fallback',
  'osRelease',
  'buildLane',
  'sources',
  'keyring',
  'kernelModules',
])
const NAME_PATTERN = /^[a-z0-9-]+$/
const PACKAGE_PATTERN = /^[a-z0-9][a-z0-9+.~-]*$/
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9.+~:-]*$/
const SHA256_PATTERN = /^[0-9a-f]{64}$/
const DEB_ARCHITECTURES = new Set(['amd64', 'arm64'])
/** uname/ConditionArchitecture names to the manifest's Debian names. */
const ARCHITECTURE_MAP = new Map([
  ['x86-64', 'amd64'],
  ['arm64', 'arm64'],
])

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpsUrl(value) {
  if (typeof value !== 'string') return false
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

function unknownKeys(value, allowed) {
  return Object.keys(value).filter((key) => !allowed.has(key))
}

function unknownFieldErrors(value, allowed, prefix) {
  return unknownKeys(value, allowed).map((key) => `${prefix}: ${key}`)
}

/**
Validate a parsed manifest. Returns the manifest with every problem
found; an empty errors array means the manifest is sound.
*/
export function validateManifest(manifest, manifestDir) {
  if (!isRecord(manifest)) return { ok: false, errors: ['manifest is not an object'] }
  const errors = [...unknownFieldErrors(manifest, MANIFEST_KEYS, 'unknown field')]
  const { name } = manifest
  if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
    errors.push('name must look like chrome or nvidia')
  } else if (path.basename(manifestDir) !== name) {
    errors.push(`manifest directory ${manifestDir} does not match name ${name}`)
  }
  if (manifest.kind !== 'sysext' && manifest.kind !== 'confext') {
    errors.push('kind must be sysext or confext')
  }
  const architectures = manifest.architectures
  if (
    !Array.isArray(architectures) ||
    architectures.length === 0 ||
    new Set(architectures).size !== architectures.length ||
    architectures.some((arch) => !DEB_ARCHITECTURES.has(arch))
  ) {
    errors.push('architectures must be a unique non-empty list of amd64 and arm64')
  }
  if (typeof manifest.vendor !== 'string' || manifest.vendor.trim() === '') {
    errors.push('vendor must be a non-empty string')
  }
  if (!isHttpsUrl(manifest.terms)) errors.push('terms must be an https URL')
  if (manifest.install !== 'user-click' && manifest.install !== 'automatic') {
    errors.push('install must be user-click or automatic')
  }
  if (
    manifest.fallback !== undefined &&
    (typeof manifest.fallback !== 'string' || manifest.fallback.trim() === '')
  ) {
    errors.push('fallback must be a non-empty string')
  }
  errors.push(...validateOsRelease(manifest.osRelease))
  if (manifest.buildLane !== 'ci' && manifest.buildLane !== 'device') {
    errors.push('buildLane must be ci or device')
  }
  errors.push(
    ...validateSources(manifest.sources, Array.isArray(architectures) ? architectures : []),
  )
  if (manifest.keyring !== undefined) {
    errors.push(...validateKeyring(manifest.keyring, manifestDir))
  }
  if (manifest.kernelModules !== undefined) {
    errors.push(...validateKernelModules(manifest.kernelModules))
  }
  return { ok: errors.length === 0, errors }
}

function validateOsRelease(osRelease) {
  if (!isRecord(osRelease)) return ['osRelease must be an object']
  const errors = [
    ...unknownFieldErrors(
      osRelease,
      new Set(['id', 'versionId', 'sysextLevel']),
      'osRelease has an unknown field',
    ),
  ]
  if (typeof osRelease.id !== 'string' || osRelease.id.trim() === '') {
    errors.push('osRelease.id must be a non-empty string')
  }
  if (typeof osRelease.versionId !== 'string' || osRelease.versionId.trim() === '') {
    errors.push('osRelease.versionId must be a non-empty string')
  }
  if (
    osRelease.sysextLevel !== undefined &&
    (typeof osRelease.sysextLevel !== 'string' || osRelease.sysextLevel.trim() === '')
  ) {
    errors.push('osRelease.sysextLevel must be a non-empty string')
  }
  return errors
}

function validateSources(sources, architectures) {
  if (!isRecord(sources)) return ['sources must be an object']
  const errors = []
  const keys = Object.keys(sources)
  if (keys.length !== architectures.length || keys.some((key) => !architectures.includes(key))) {
    errors.push(`sources must cover exactly the architectures: ${architectures.join(',')}`)
  }
  for (const [arch, source] of Object.entries(sources)) {
    errors.push(...validateSource(source, arch))
  }
  return errors
}

function validateSource(source, arch) {
  const where = `sources.${arch}`
  if (!isRecord(source)) return [`${where} must be an object`]
  const keys = Object.keys(source)
  if (keys.length !== 1 || (keys[0] !== 'apt' && keys[0] !== 'vendorRun')) {
    return [`${where} must hold exactly one of apt and vendorRun`]
  }
  return keys[0] === 'apt'
    ? validateAptSource(source.apt, where)
    : validateVendorRunSource(source.vendorRun, where)
}

function validateAptSource(apt, where) {
  if (!isRecord(apt)) return [`${where}.apt must be an object`]
  const errors = [
    ...unknownFieldErrors(
      apt,
      new Set(['uri', 'suite', 'component', 'packages', 'version']),
      `${where}.apt has an unknown field`,
    ),
  ]
  if (!isHttpsUrl(apt.uri)) errors.push(`${where}.apt.uri must be an https URL`)
  const hasSuite = typeof apt.suite === 'string' && apt.suite !== ''
  const hasComponent = typeof apt.component === 'string' && apt.component !== ''
  if (hasSuite !== hasComponent) {
    errors.push(`${where}.apt needs suite and component together, or neither for a flat repo`)
  }
  if (
    !Array.isArray(apt.packages) ||
    apt.packages.length === 0 ||
    new Set(apt.packages).size !== apt.packages.length ||
    apt.packages.some((name) => typeof name !== 'string' || !PACKAGE_PATTERN.test(name))
  ) {
    errors.push(`${where}.apt.packages must be a unique non-empty list of package names`)
  }
  if (
    apt.version !== undefined &&
    (typeof apt.version !== 'string' || !VERSION_PATTERN.test(apt.version))
  ) {
    errors.push(`${where}.apt.version must be a version string`)
  }
  return errors
}

function validateVendorRunSource(vendorRun, where) {
  if (!isRecord(vendorRun)) return [`${where}.vendorRun must be an object`]
  const errors = [
    ...unknownFieldErrors(
      vendorRun,
      new Set(['url', 'sha256']),
      `${where}.vendorRun has an unknown field`,
    ),
  ]
  if (!isHttpsUrl(vendorRun.url)) errors.push(`${where}.vendorRun.url must be an https URL`)
  if (typeof vendorRun.sha256 !== 'string' || !SHA256_PATTERN.test(vendorRun.sha256)) {
    errors.push(`${where}.vendorRun.sha256 must be 64 lowercase hex digits`)
  }
  return errors
}

function validateKeyring(keyring, manifestDir) {
  if (!isRecord(keyring)) return ['keyring must be an object']
  const errors = [
    ...unknownFieldErrors(
      keyring,
      new Set(['url', 'fingerprints']),
      'keyring has an unknown field',
    ),
  ]
  if (!isHttpsUrl(keyring.url)) errors.push('keyring.url must be an https URL')
  if (typeof keyring.fingerprints !== 'string' || keyring.fingerprints.trim() === '') {
    errors.push('keyring.fingerprints must be a relative file path')
    return errors
  }
  const resolved = path.resolve(manifestDir, keyring.fingerprints)
  if (!resolved.startsWith(`${path.resolve(manifestDir)}${path.sep}`)) {
    errors.push('keyring.fingerprints must stay inside the manifest directory')
    return errors
  }
  let text
  try {
    text = readFileSync(resolved, 'utf8')
  } catch {
    errors.push(`keyring.fingerprints is not readable: ${keyring.fingerprints}`)
    return errors
  }
  const parsed = parseFingerprintsFile(text)
  if (!parsed.ok) errors.push(`keyring.fingerprints: ${parsed.error}`)
  return errors
}

function validateKernelModules(modules) {
  if (!isRecord(modules)) return ['kernelModules must be an object']
  const errors = [
    ...unknownFieldErrors(
      modules,
      new Set(['open', 'proprietary', 'mokSign']),
      'kernelModules has an unknown field',
    ),
  ]
  for (const key of ['open', 'proprietary', 'mokSign']) {
    if (typeof modules[key] !== 'boolean') errors.push(`kernelModules.${key} must be a boolean`)
  }
  if (modules.open === false && modules.proprietary === false) {
    errors.push('kernelModules needs at least one of open and proprietary')
  }
  return errors
}

/** Parse an os-release/extension-release file into a plain map. */
export function parseReleaseFile(text) {
  const values = new Map()
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || trimmed.startsWith('#')) continue
    const equals = trimmed.indexOf('=')
    if (equals === -1) continue
    const key = trimmed.slice(0, equals).trim()
    let value = trimmed.slice(equals + 1).trim()
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      // eslint-disable-next-line unicorn/prefer-string-raw -- escape pairs read clearest as escapes in this unescaper.
      value = value.slice(1, -1).replaceAll('\\"', '"').replaceAll('\\\\', '\\')
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1)
    }
    if (key !== '') values.set(key, value)
  }
  return values
}

/**
Compare a built extension tree against the manifest: the
extension-release file must name the add-on and carry the manifest's OS
match, and a sysext tree must not ship its own os-release.
*/
export function validateTree(manifest, treeDir) {
  const errors = []
  const releaseDir =
    manifest.kind === 'confext'
      ? path.join(treeDir, 'etc', 'extension-release.d')
      : path.join(treeDir, 'usr', 'lib', 'extension-release.d')
  const releasePath = path.join(releaseDir, `extension-release.${manifest.name}`)
  let text
  try {
    if (!statSync(releasePath).isFile()) throw new Error('not a file')
    text = readFileSync(releasePath, 'utf8')
  } catch {
    return { ok: false, errors: [`missing extension-release file: ${releasePath}`] }
  }
  const values = parseReleaseFile(text)
  if (values.get('ID') !== manifest.osRelease.id) {
    errors.push(
      `extension ID ${values.get('ID') ?? '(missing)'} does not match ${manifest.osRelease.id}`,
    )
  }
  if (values.has('SYSEXT_LEVEL')) {
    if (values.get('SYSEXT_LEVEL') !== (manifest.osRelease.sysextLevel ?? '')) {
      errors.push('extension SYSEXT_LEVEL does not match the manifest')
    }
  } else if (values.get('VERSION_ID') !== manifest.osRelease.versionId) {
    errors.push(
      `extension VERSION_ID ${values.get('VERSION_ID') ?? '(missing)'} does not match ${manifest.osRelease.versionId}`,
    )
  }
  const architecture = values.get('ARCHITECTURE')
  if (architecture !== undefined && architecture !== '_any') {
    const mapped = ARCHITECTURE_MAP.get(architecture)
    if (mapped === undefined || !manifest.architectures.includes(mapped)) {
      errors.push(`extension ARCHITECTURE ${architecture} is not one of the manifest architectures`)
    }
  }
  if (manifest.kind === 'sysext' && existsSync(path.join(treeDir, 'usr', 'lib', 'os-release'))) {
    errors.push('a sysext tree must not ship usr/lib/os-release')
  }
  return { ok: errors.length === 0, errors }
}
