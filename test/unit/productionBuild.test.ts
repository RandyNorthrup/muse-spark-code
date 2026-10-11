import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertCurrentProductionBuild,
  buildGeneration,
  productionBuildSetup,
  requiresProductionBuild,
} from './productionBuild'

const root = path.resolve('repo-root')
const at = (file: string) => path.join(root, file)
const HARNESS = 'test/unit/devicesPhase2Harness.test.mjs'

/** A fake Vitest project that records what the setup provides and its rerun listener. */
function fakeProject(selected: string[]) {
  const provided: string[] = []
  const keys: string[] = []
  const listeners: ((specifications: readonly { readonly moduleId: string }[]) => void)[] = []
  const project = {
    config: { root },
    vitest: { state: { getPaths: () => selected } },
    provide: (key: 'deviceProductionBuild', value: string) => {
      keys.push(key)
      provided.push(value)
    },
    onTestsRerun: (listener: (typeof listeners)[number]) => {
      listeners.push(listener)
    },
  }
  const rerun = (files: string[]) => {
    for (const listener of listeners) listener(files.map((file) => ({ moduleId: at(file) })))
  }
  return { project, provided, keys, rerun }
}

describe('the shared production build (vitest global setup)', () => {
  it('builds when a selected file serves dist/, whatever the path separators', () => {
    expect(requiresProductionBuild(root, [at(HARNESS)])).toBe(true)
    expect(
      requiresProductionBuild(root, [
        at('test/unit/a.test.ts'),
        at('test/unit/teamHarness.test.mjs').replaceAll('\\', '/'),
      ]),
    ).toBe(true)
  })

  it('skips the build when no selected file serves dist/', () => {
    expect(requiresProductionBuild(root, [])).toBe(false)
    expect(requiresProductionBuild(root, [at('test/unit/devicesPanel.test.ts')])).toBe(false)
    expect(
      requiresProductionBuild(root, [path.join(root, 'other', 'test/unit/teamHarness.test.mjs')]),
    ).toBe(false)
  })

  it('refuses a build from source generation A once the sources are generation B', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm100-build-generation-'))
    try {
      await writeFile(path.join(folder, 'package.json'), '{}')
      await writeFile(path.join(folder, 'a.ts'), 'export const a = 1\n')
      const inputs = ['a.ts', 'package.json']
      const generationA = buildGeneration(folder, inputs)
      assertCurrentProductionBuild(generationA, folder, inputs)
      // An edit after the build, with no rebuild: the proof no longer matches.
      await writeFile(path.join(folder, 'a.ts'), 'export const a = 2\n')
      expect(() => {
        assertCurrentProductionBuild(generationA, folder, inputs)
      }).toThrow('Stale shared production build')
      const generationB = buildGeneration(folder, inputs)
      expect(generationB).not.toBe(generationA)
      assertCurrentProductionBuild(generationB, folder, inputs)
      expect(() => {
        assertCurrentProductionBuild('', folder, inputs)
      }).toThrow('No shared production build in this run')
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('invalidates the production proof when release design inputs or changelog change', async () => {
    const folder = await mkdtemp(path.join(tmpdir(), 'm100-release-build-inputs-'))
    try {
      await mkdir(path.join(folder, 'design'))
      await writeFile(path.join(folder, 'design/tokens.json'), '{}')
      await writeFile(path.join(folder, 'CHANGELOG.md'), '# Changelog')
      execFileSync('git', ['init', '--quiet', folder])
      execFileSync('git', ['add', '--', 'design/tokens.json', 'CHANGELOG.md'], { cwd: folder })
      const original = buildGeneration(folder)
      await writeFile(path.join(folder, 'design/tokens.json'), '{"color":"red"}')
      const designChanged = buildGeneration(folder)
      expect(designChanged).not.toBe(original)
      await writeFile(path.join(folder, 'CHANGELOG.md'), '# Changed release notes')
      expect(buildGeneration(folder)).not.toBe(designChanged)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  })

  it('builds again on a watch rerun that selects a serving suite, and only then', () => {
    let generation = 'A'
    const build = vi.fn()
    const setup = productionBuildSetup({ build, generation: () => generation })
    const { project, provided, keys, rerun } = fakeProject([at(HARNESS)])
    setup(project)
    expect(build).toHaveBeenCalledOnce()
    expect(provided).toEqual(['A'])
    expect(keys).toEqual(['deviceProductionBuild'])
    generation = 'B'
    rerun([HARNESS])
    expect(build).toHaveBeenCalledTimes(2)
    expect(provided.at(-1)).toBe('B')
    rerun(['test/unit/devicesPanel.test.ts'])
    expect(build).toHaveBeenCalledTimes(2)
    expect(provided.at(-1)).toBe('')
  })

  it('provides no proof and builds nothing when no serving suite is selected', () => {
    const build = vi.fn()
    const { project, provided } = fakeProject([at('test/unit/devicesPanel.test.ts')])
    productionBuildSetup({ build, generation: () => 'A' })(project)
    expect(build).not.toHaveBeenCalled()
    expect(provided).toEqual([''])
  })
})
