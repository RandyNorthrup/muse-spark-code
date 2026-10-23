// The fourteen pack build definitions (M110t TP1, D90.27): every
// deploy/packs/*.json parses, names its file, requires only packs that
// exist (acyclically), covers every tool licence in its expression,
// and carries the decision's composition facts (dpdm not madge, the
// TypeScript 6 peer pin, click-through only for the Android SDK).
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  packBuildDefinitionSchema,
  type PackBuildDefinition,
} from '../../src/runtime/node/packs/definition'
import type { PackName } from '../../src/shared/profile'

const PACKS_DIR = path.join(__dirname, '..', '..', 'deploy', 'packs')

function compareStrings(left: string, right: string): number {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function loadDefinitions(): PackBuildDefinition[] {
  return readdirSync(PACKS_DIR)
    .filter((file) => file.endsWith('.json'))
    .toSorted(compareStrings)
    .map((file) => {
      const parsed = packBuildDefinitionSchema.parse(
        JSON.parse(readFileSync(path.join(PACKS_DIR, file), 'utf8')),
      )
      expect(parsed.name).toBe(path.basename(file, '.json'))
      return parsed
    })
}

const definitions = loadDefinitions()
const byName = new Map<string, PackBuildDefinition>(
  definitions.map((definition) => [definition.name, definition]),
)

function licencesOf(expression: string): Set<string> {
  return new Set(
    expression
      .split(/\s+(?:AND|OR)\s+|[()]/)
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
}

describe('pack build definitions', () => {
  it('carries the fourteen packs', () => {
    const names: PackName[] = [
      'typescript',
      'python',
      'rust',
      'cpp',
      'csharp',
      'go',
      'java',
      'shell',
      'devops',
      'docs',
      'mobile',
      'makers',
      'game',
      'crosscutting',
    ]
    expect(definitions.map((definition) => definition.name).toSorted(compareStrings)).toEqual(
      names.toSorted(compareStrings),
    )
  })

  it('requires only packs that exist, acyclically', () => {
    const visiting = new Set<string>()
    const visited = new Set<string>()
    const visit = (name: string): void => {
      if (visited.has(name)) return
      if (visiting.has(name)) throw new Error(`require cycle at ${name}`)
      const definition = byName.get(name)
      if (definition === undefined) throw new Error(`unknown pack ${name}`)
      visiting.add(name)
      for (const required of definition.requires) visit(required)
      visiting.delete(name)
      visited.add(name)
    }
    for (const definition of definitions) visit(definition.name)
    expect(byName.get('docs')?.requires).toEqual(['typescript'])
    expect(byName.get('crosscutting')?.requires).toEqual(['typescript'])
    expect(byName.get('typescript')?.requires).toEqual(['python'])
    expect(byName.get('mobile')?.requires).toEqual(['java'])
    expect(byName.get('makers')?.requires).toEqual(['python'])
  })

  it('covers every tool licence in the pack expression', () => {
    for (const definition of definitions) {
      const covered = licencesOf(definition.license)
      const owned: string[] = [
        ...definition.upstream.map((artifact) => artifact.license),
        ...(definition.managed?.npm ?? []).map((tool) => tool.license),
        ...(definition.managed?.cargo ?? []).map((tool) => tool.license),
        ...(definition.managed?.uvTools ?? []).map((tool) => tool.license),
        ...(definition.managed?.uvPythons ?? []).map((tool) => tool.license),
        ...(definition.managed?.go ?? []).map((tool) => tool.license),
        ...(definition.managed?.psGallery ?? []).map((tool) => tool.license),
        ...(definition.managed?.rust ?? []).map((tool) => tool.license),
        ...(definition.apt?.packages ?? []).map((tool) => tool.license),
      ]
      for (const licence of owned) {
        const options = licence.split(/\s+OR\s+/)
        expect(
          options.some((option) => covered.has(option.trim())),
          `${definition.name}: ${licence} not covered by ${definition.license}`,
        ).toBe(true)
      }
    }
  })

  it('clicks through only the Android SDK', () => {
    for (const definition of definitions) {
      expect(definition.clickThrough).toBe(definition.name === 'mobile')
    }
  })

  it('downloads only over https, with checks and smoke', () => {
    for (const definition of definitions) {
      for (const artifact of definition.upstream) {
        expect(artifact.url.startsWith('https://'), `${definition.name}: ${artifact.url}`).toBe(
          true,
        )
      }
      expect(definition.checks.length).toBeGreaterThan(0)
      expect(definition.smoke.length).toBeGreaterThan(0)
    }
  })

  it('pins both Node lines and both Rust channels', () => {
    const typescript = byName.get('typescript')
    const nodeVersions = new Set(
      (typescript?.upstream ?? [])
        .filter((artifact) => artifact.name.startsWith('node-'))
        .map((artifact) => artifact.version),
    )
    expect(nodeVersions).toEqual(new Set(['24.22.1', '22.23.4']))
    const rust = byName.get('rust')?.managed?.rust ?? []
    expect(rust.map((channel) => channel.name)).toEqual(['rust', 'rust-nightly'])
    expect(rust[1]?.version.startsWith('nightly-')).toBe(true)
  })

  it('carries dpdm not madge, and pins TypeScript to the peer range', () => {
    const tools = (byName.get('typescript')?.managed?.npm ?? []).map((tool) => tool.name)
    expect(tools).toContain('dpdm')
    expect(tools).not.toContain('madge')
    expect(byName.get('typescript')?.constraints).toEqual([
      {
        package: 'typescript',
        range: '>=6.0.0 <6.1.0',
        reason: expect.any(String),
      },
    ])
  })

  it('keeps the mobile pack x86-64 only', () => {
    const upstream = byName.get('mobile')?.upstream ?? []
    for (const artifact of upstream) {
      expect(artifact.platforms).toEqual([{ os: 'linux', arch: 'x64' }])
    }
  })

  it('pins a shared upstream identically in every pack', () => {
    // node-24 and uv ride several packs so each layer installs
    // standalone; a drifted copy would build a different toolchain.
    const pins = new Map<string, Set<string>>()
    for (const definition of definitions) {
      for (const artifact of definition.upstream) {
        const arches = (artifact.platforms ?? [{ os: 'linux', arch: 'x64' }]).map(
          (platform) => platform.arch,
        )
        for (const arch of arches) {
          const key = `${artifact.name}/${arch}`
          const pin = `${artifact.version} ${artifact.url}`
          const seen = pins.get(key) ?? new Set<string>()
          seen.add(`${definition.name}: ${pin}`)
          pins.set(key, seen)
        }
      }
    }
    for (const [key, seen] of pins) {
      const versions = new Set([...seen].map((entry) => entry.split(': ', 2)[1]))
      expect(versions.size, `${key} drifts: ${[...seen].join(' vs ')}`).toBe(1)
    }
  })

  it('resolves every apt snapshot to the same timestamp', () => {
    const snapshots = definitions
      .filter((definition) => definition.apt !== undefined)
      .map((definition) => definition.apt?.snapshot)
    expect(snapshots.length).toBeGreaterThan(0)
    expect(new Set(snapshots).size).toBe(1)
  })
})
