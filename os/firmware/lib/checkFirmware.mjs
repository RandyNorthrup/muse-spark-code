// M110os OS5: the base-firmware check. The firmware set names the Debian
// packages the base image must carry; the check resolves each one
// against snapshot.debian.org so a rename or a typo breaks CI instead
// of the base build. Node builtins only, so the device and CI run it
// bare.
import { readFileSync } from 'node:fs'

const PACKAGE_PATTERN = /^[a-z0-9][a-z0-9+.~-]*$/
const FIRMWARE_GROUPS = new Set(['amd', 'intel', 'wifi'])

/**
Parse the firmware set: exactly the amd, intel and wifi groups, each a
unique non-empty list of package names.
*/
export function parseFirmwareFile(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'firmware file is not JSON' }
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, error: 'firmware file must hold an object' }
  }
  const topKeys = Object.keys(data)
  if (topKeys.length !== 1 || topKeys[0] !== 'packages') {
    return { ok: false, error: 'firmware file must hold exactly packages' }
  }
  const { packages } = data
  if (typeof packages !== 'object' || packages === null || Array.isArray(packages)) {
    return { ok: false, error: 'packages must be an object' }
  }
  const groups = Object.keys(packages)
  if (
    groups.length !== FIRMWARE_GROUPS.size ||
    groups.some((group) => !FIRMWARE_GROUPS.has(group))
  ) {
    return { ok: false, error: 'packages must hold exactly amd, intel and wifi' }
  }
  const names = []
  for (const group of ['amd', 'intel', 'wifi']) {
    const list = packages[group]
    if (
      !Array.isArray(list) ||
      list.length === 0 ||
      new Set(list).size !== list.length ||
      list.some((name) => typeof name !== 'string' || !PACKAGE_PATTERN.test(name))
    ) {
      return { ok: false, error: `packages.${group} must be a unique non-empty list of names` }
    }
    names.push(...list)
  }
  return new Set(names).size === names.length
    ? { ok: true, names }
    : { ok: false, error: 'a package is listed in two groups' }
}

/**
Parse one snapshot.debian.org `/mr/binary/<name>/` response into the
source package and the listed binary versions, first-listed first.
*/
export function parseSnapshotResponse(text) {
  let data
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'snapshot response is not JSON' }
  }
  const result = data?.result
  if (!Array.isArray(result) || result.length === 0) {
    return { ok: false, error: 'snapshot lists no versions' }
  }
  const versions = []
  let source
  for (const entry of result) {
    if (
      typeof entry !== 'object' ||
      entry === null ||
      typeof entry.binary_version !== 'string' ||
      entry.binary_version === '' ||
      typeof entry.source !== 'string' ||
      entry.source === ''
    ) {
      return { ok: false, error: 'a snapshot entry has no binary_version or source' }
    }
    source ??= entry.source
    versions.push(entry.binary_version)
  }
  return { ok: true, source, versions }
}

/**
Resolve one package: read its recorded transcript, or fetch the live
snapshot response. A 404 or an empty listing means the package is
unknown; anything else that goes wrong is a tool failure.
*/
export async function resolvePackage(name, { snapshotBase, transcriptDir }) {
  if (transcriptDir !== undefined) {
    let text
    try {
      text = readFileSync(`${transcriptDir}/${name}.json`, 'utf8')
    } catch {
      return { ok: false, kind: 'unknown', error: `no transcript for ${name}` }
    }
    const parsed = parseSnapshotResponse(text)
    return parsed.ok
      ? { ok: true, source: parsed.source, versions: parsed.versions }
      : { ok: false, kind: 'unknown', error: `${name}: ${parsed.error}` }
  }
  let response
  try {
    response = await fetch(`${snapshotBase}/mr/binary/${name}/`)
  } catch (error) {
    return { ok: false, kind: 'tool', error: `snapshot fetch failed: ${String(error)}` }
  }
  if (response.status === 404)
    return { ok: false, kind: 'unknown', error: `unknown package: ${name}` }
  if (!response.ok) {
    return { ok: false, kind: 'tool', error: `snapshot answered ${String(response.status)}` }
  }
  const parsed = parseSnapshotResponse(await response.text())
  return parsed.ok
    ? { ok: true, source: parsed.source, versions: parsed.versions }
    : { ok: false, kind: 'unknown', error: `${name}: ${parsed.error}` }
}
