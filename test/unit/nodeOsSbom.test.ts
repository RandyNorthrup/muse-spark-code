// M110os2 OS6: the SPDX SBOM writer. os-sbom runs as a child process
// for usage and refusal; the manifest parser and the SPDX builder run
// over the recorded x86-64 manifest
// (test/fixtures/nodeos-manifest/CAPTURE.md), asserting every package
// lands with its exact name, version and purl.
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { cleanup, runNodeScript, scratch, sha256File } from './helpers/nodeOs'
import { parseManifest, sha256File as hashFile, spdxDocument } from '../../scripts/lib/osSbom.mjs'

const SBOM = fileURLToPath(new URL('../../scripts/os-sbom.mjs', import.meta.url))
const MANIFEST = fileURLToPath(
  new URL('../../test/fixtures/nodeos-manifest/muse-node-x86-64.manifest', import.meta.url),
)
const MANIFEST_SHA256 = '6df4c8aeacd9de31278be408595ccdab9c9a5174aeacdf4077494adc8fe9b997'
const IMAGE_SHA256 = '5762a3a89d8be41e61697504c816c25ad4a215ffd2a54f40b60e0916192b4508'

const spdxPackageSchema = z.object({
  SPDXID: z.string(),
  name: z.string(),
  versionInfo: z.string(),
  supplier: z.literal('NOASSERTION'),
  downloadLocation: z.literal('NOASSERTION'),
  filesAnalyzed: z.literal(false),
  licenseConcluded: z.literal('NOASSERTION'),
  licenseDeclared: z.literal('NOASSERTION'),
  copyrightText: z.literal('NOASSERTION'),
  externalRefs: z.array(z.record(z.string(), z.string())),
})
const spdxRelationshipSchema = z.object({
  spdxElementId: z.string(),
  relationshipType: z.string(),
  relatedSpdxElement: z.string(),
})
const spdxDocumentSchema = z.object({
  spdxVersion: z.literal('SPDX-2.3'),
  dataLicense: z.literal('CC0-1.0'),
  SPDXID: z.literal('SPDXRef-DOCUMENT'),
  name: z.string(),
  documentNamespace: z.string(),
  creationInfo: z.object({ created: z.string(), creators: z.array(z.string()) }),
  packages: z.array(spdxPackageSchema),
  relationships: z.array(spdxRelationshipSchema),
})

describe('os-sbom usage', () => {
  it('prints help and refuses bad input with a usage error', () => {
    const help = runNodeScript(SBOM, ['--help'])
    expect(help.status).toBe(0)
    expect(help.out).toContain('usage: os-sbom.mjs')
    const dir = scratch('nodeos-sbom-')
    try {
      expect(runNodeScript(SBOM, []).status).toBe(2)
      expect(runNodeScript(SBOM, ['--bogus']).status).toBe(2)
      expect(runNodeScript(SBOM, ['--manifest', MANIFEST, '--image', MANIFEST]).status).toBe(2)
      const missing = path.join(dir, 'absent.manifest')
      expect(
        runNodeScript(SBOM, [
          '--manifest',
          missing,
          '--image',
          MANIFEST,
          '--out',
          path.join(dir, 'out.json'),
        ]).status,
      ).toBe(2)
    } finally {
      cleanup(dir)
    }
  })

  it('refuses a malformed manifest without writing output', () => {
    const dir = scratch('nodeos-sbom-')
    try {
      const bad = path.join(dir, 'bad.manifest')
      const out = path.join(dir, 'out.json')
      writeFileSync(bad, '{"manifest_version": 1}')
      const run = runNodeScript(SBOM, ['--manifest', bad, '--image', bad, '--out', out])
      expect(run.status).toBe(2)
      expect(run.out).toContain('manifest config must be an object')
      expect(() => readFileSync(out, 'utf8')).toThrow()
      writeFileSync(bad, 'not json')
      const runJson = runNodeScript(SBOM, ['--manifest', bad, '--image', bad, '--out', out])
      expect(runJson.status).toBe(2)
      expect(runJson.out).toContain('manifest is not JSON')
    } finally {
      cleanup(dir)
    }
  })
})

describe('os-sbom conversion', () => {
  it('maps the recorded manifest to SPDX with every package exact', () => {
    expect(sha256File(MANIFEST)).toBe(MANIFEST_SHA256)
    const parsed = parseManifest(readFileSync(MANIFEST, 'utf8'))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.manifest.packages.length).toBe(147)
    const document = spdxDocument(parsed.manifest, IMAGE_SHA256, '2026-10-23T00:00:00Z')
    const checked = spdxDocumentSchema.parse(document)
    expect(checked.name).toBe('muse-node-x86-64-0.19.0')
    expect(checked.packages.length).toBe(148)
    const [image, ...debs] = checked.packages
    expect(image?.SPDXID).toBe('SPDXRef-Image')
    expect(image?.versionInfo).toBe('0.19.0')
    expect(
      image?.externalRefs.some(
        (reference) =>
          reference['referenceType'] === 'sha256' && reference['referenceLocator'] === IMAGE_SHA256,
      ),
    ).toBe(true)
    for (const [index, entry] of parsed.manifest.packages.entries()) {
      const deb = debs[index]
      expect(deb?.SPDXID).toBe(`SPDXRef-Package-${String(index + 1)}`)
      expect(deb?.name).toBe(entry.name)
      expect(deb?.versionInfo).toBe(entry.version)
      expect(deb?.externalRefs).toContainEqual({
        referenceCategory: 'PACKAGE-MANAGER',
        referenceType: 'purl',
        referenceLocator: `pkg:deb/debian/${entry.name}@${entry.version}?arch=${entry.architecture}`,
      })
    }
    expect(checked.relationships[0]).toEqual({
      spdxElementId: 'SPDXRef-DOCUMENT',
      relationshipType: 'DESCRIBES',
      relatedSpdxElement: 'SPDXRef-Image',
    })
    const contains = checked.relationships.slice(1)
    expect(contains.length).toBe(147)
    for (const [index, relationship] of contains.entries()) {
      expect(relationship).toEqual({
        spdxElementId: 'SPDXRef-Image',
        relationshipType: 'CONTAINS',
        relatedSpdxElement: `SPDXRef-Package-${String(index + 1)}`,
      })
    }
  })

  it('hashes the image file it is given', async () => {
    const dir = scratch('nodeos-sbom-')
    try {
      const image = path.join(dir, 'image.raw')
      writeFileSync(image, 'node-os test image bytes')
      await expect(hashFile(image)).resolves.toBe(sha256File(image))
      await expect(hashFile(path.join(dir, 'absent.raw'))).rejects.toThrow('image is not readable')
    } finally {
      cleanup(dir)
    }
  })
})
