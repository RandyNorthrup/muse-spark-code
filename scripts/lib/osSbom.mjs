// M110os2 OS6: the SPDX SBOM writer. It turns mkosi's JSON package
// manifest (manifest_version 1) into an SPDX 2.3 document naming the
// image and every Debian package it carries, with a purl per package.
// Versions and architectures come from the manifest untouched; anything
// the manifest does not say (supplier, download location, licence) is
// NOASSERTION, never a guess. Node builtins only, so CI and any rig
// run it bare.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value !== ''
}

/**
Parse and validate a mkosi JSON manifest. Returns { ok, manifest } or
{ ok: false, error }. Only manifest_version 1 with deb packages.
*/
export function parseManifest(text) {
  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'manifest is not JSON' }
  }
  if (!isRecord(raw)) return { ok: false, error: 'manifest must be an object' }
  if (raw.manifest_version !== 1) return { ok: false, error: 'manifest_version must be 1' }
  if (!isRecord(raw.config)) return { ok: false, error: 'manifest config must be an object' }
  for (const key of ['name', 'distribution', 'architecture', 'version', 'release']) {
    if (!isNonEmptyString(raw.config[key])) {
      return { ok: false, error: `manifest config.${key} must be a non-empty string` }
    }
  }
  if (!Array.isArray(raw.packages) || raw.packages.length === 0) {
    return { ok: false, error: 'manifest packages must be a non-empty array' }
  }
  for (const entry of raw.packages) {
    if (!isRecord(entry)) return { ok: false, error: 'manifest packages must be objects' }
    if (entry.type !== 'deb') return { ok: false, error: 'manifest packages must be debs' }
    for (const key of ['name', 'version', 'architecture']) {
      if (!isNonEmptyString(entry[key])) {
        return { ok: false, error: `manifest package.${key} must be a non-empty string` }
      }
    }
    const { size } = entry
    if (!Number.isSafeInteger(size) || size < 0) {
      return { ok: false, error: 'manifest package.size must be a non-negative integer' }
    }
  }
  return { ok: true, manifest: raw }
}

/** SHA-256 of a file, streamed so multi-gigabyte images never load whole. */
export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(file)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('end', () => resolve(hash.digest('hex')))
    stream.once('error', (cause) => reject(new Error(`image is not readable: ${file}`, { cause })))
  })
}

function debPurl(entry) {
  return `pkg:deb/debian/${entry.name}@${entry.version}?arch=${entry.architecture}`
}

/**
Build the SPDX 2.3 document for one image and its manifest. imageSha256
is the raw image's digest; created is the generation timestamp.
*/
export function spdxDocument(manifest, imageSha256, created) {
  const { config, packages } = manifest
  const name = `muse-node-${config.architecture}-${config.version}`
  const image = {
    SPDXID: 'SPDXRef-Image',
    name: `muse-node-${config.architecture}`,
    versionInfo: config.version,
    supplier: 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'OTHER',
        referenceType: 'sha256',
        referenceLocator: imageSha256,
      },
    ],
  }
  const entries = packages.map((entry, index) => ({
    SPDXID: `SPDXRef-Package-${String(index + 1)}`,
    name: entry.name,
    versionInfo: entry.version,
    supplier: 'NOASSERTION',
    downloadLocation: 'NOASSERTION',
    filesAnalyzed: false,
    licenseConcluded: 'NOASSERTION',
    licenseDeclared: 'NOASSERTION',
    copyrightText: 'NOASSERTION',
    externalRefs: [
      {
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: debPurl(entry),
      },
    ],
  }))
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name,
    documentNamespace: `https://github.com/RandyNorthrup/muse-spark-code/spdx/${name}-${imageSha256.slice(0, 12)}`,
    creationInfo: {
      created,
      creators: ['Tool: muse-spark-code-os-sbom'],
    },
    packages: [image, ...entries],
    relationships: [
      {
        spdxElementId: 'SPDXRef-DOCUMENT',
        relationshipType: 'DESCRIBES',
        relatedSpdxElement: 'SPDXRef-Image',
      },
      ...entries.map((entry) => ({
        spdxElementId: 'SPDXRef-Image',
        relationshipType: 'CONTAINS',
        relatedSpdxElement: entry.SPDXID,
      })),
    ],
  }
}
