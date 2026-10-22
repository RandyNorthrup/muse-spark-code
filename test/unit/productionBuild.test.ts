import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
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
  const listeners: ((specifications: readonly { readonly moduleId: string }[]) => void)[] = []
  const project = {
    config: { root },
    vitest: { state: { getPaths: () => selected } },
    provide: (_key: 'productionBuild', value: string) => {
      provided.push(value)
    },
    onTestsRerun: (listener: (typeof listeners)[number]) => {
      listeners.push(listener)
    },
  }
  const rerun = (files: string[]) => {
    for (const listener of listeners) listener(files.map((file) => ({ moduleId: at(file) })))
  }
  return { project, provided, rerun }
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

  it('builds again on a watch rerun that selects a serving suite, and only then', () => {
    let generation = 'A'
    const builds: string[] = []
    const build = (root: string) => {
      builds.push(root)
    }
    const setup = productionBuildSetup({ build, generation: () => generation })
    const { project, provided, rerun } = fakeProject([at(HARNESS)])
    setup(project)
    expect(builds).toHaveLength(1)
    expect(provided).toEqual(['A'])
    generation = 'B'
    rerun([HARNESS])
    expect(builds).toHaveLength(2)
    expect(provided.at(-1)).toBe('B')
    rerun(['test/unit/devicesPanel.test.ts'])
    expect(builds).toHaveLength(2)
    expect(provided.at(-1)).toBe('')
  })

  it('provides no proof and builds nothing when no serving suite is selected', () => {
    const builds: string[] = []
    const { project, provided } = fakeProject([at('test/unit/devicesPanel.test.ts')])
    productionBuildSetup({
      build: (root) => {
        builds.push(root)
      },
      generation: () => 'A',
    })(project)
    expect(builds).toHaveLength(0)
    expect(provided).toEqual([''])
  })
})
