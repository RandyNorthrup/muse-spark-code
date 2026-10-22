import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { detectProjectKinds, type ProjectDetectIo } from '../../src/core/maker/detect/projectKinds'
import { nodeProjectDetectIo } from '../../src/core/maker/detect/projectIo'
import {
  MAKER_DETECT_MAX_BYTES,
  MAKER_DETECT_MAX_DEPTH,
  MAKER_DETECT_MAX_FILES,
  MAKER_PROJECT_KINDS,
} from '../../src/shared/constants'

const fixtureSchema = z.array(
  z.object({
    kind: z.enum(MAKER_PROJECT_KINDS),
    files: z.record(z.string(), z.string()),
  }),
)
const fixtures = fixtureSchema.parse(
  JSON.parse(await readFile('test/fixtures/maker/projects.json', 'utf8')),
)
const roots: string[] = []

async function workspace(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'm103-d-'))
  roots.push(root)
  await Promise.all(
    Object.entries(files).map(async ([name, text]) => {
      await mkdir(path.dirname(path.join(root, name)), { recursive: true })
      await writeFile(path.join(root, name), text)
    }),
  )
  return root
}

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('maker project detection on fixture workspaces', () => {
  it.each(fixtures)('detects $kind with the real bounded Node reader', async ({ kind, files }) => {
    const result = await detectProjectKinds(await workspace(files), process.platform)
    expect(result.kinds).toEqual([kind])
    expect(result.markers.every((marker) => marker.kind === kind)).toBe(true)
    expect(result.skillIds.length).toBeGreaterThan(0)
    expect(result.hasMachineConfig).toBe(kind === 'klipper' || kind === 'marlin')
  })

  it('finds a CIRCUITPY root without reading a device or sniffing its secrets', async () => {
    const parent = await workspace({
      'CIRCUITPY/settings.toml': '# excluded',
      'CIRCUITPY/secrets.yaml': '# excluded',
    })
    const reads: string[] = []
    const read: typeof nodeProjectDetectIo.read = (root, name, maxBytes) => {
      reads.push(name)
      return nodeProjectDetectIo.read(root, name, maxBytes)
    }
    const result = await detectProjectKinds(path.join(parent, 'CIRCUITPY'), process.platform, {
      ...nodeProjectDetectIo,
      read,
    })
    expect(result).toMatchObject({
      kinds: ['circuitpython'],
      skillIds: ['maker_micropython'],
      isCircuitPyRoot: true,
    })
    expect(reads).toEqual([])
  })

  it('adds nothing for ordinary code, comments and ROS 1, and does not sniff sdkconfig', async () => {
    const root = await workspace({
      'main.py': '# import board\nprint("hello")',
      'CMakeLists.txt': '# include($ENV{IDF_PATH}/tools/cmake/project.cmake)',
      'package.xml': '<build_type>catkin</build_type>',
      'config.yaml': 'name: web\n',
      sdkconfig: '# uninspected',
    })
    const reads: string[] = []
    const read: typeof nodeProjectDetectIo.read = (root, name, maxBytes) => {
      reads.push(name)
      return nodeProjectDetectIo.read(root, name, maxBytes)
    }
    expect(
      await detectProjectKinds(root, process.platform, { ...nodeProjectDetectIo, read }),
    ).toEqual({
      kinds: [],
      markers: [],
      skillIds: [],
      isCircuitPyRoot: false,
      hasMachineConfig: false,
    })
    expect(reads).not.toContain('sdkconfig')
  })

  it('does not follow linked marker files or directories, even within the workspace', async () => {
    const root = await workspace({
      'vendor/linked.scad': 'cube(1);',
      'outside/CMakeLists.txt': 'include($ENV{IDF_PATH}/tools/cmake/project.cmake)',
    })
    await symlink(path.join(root, 'vendor/linked.scad'), path.join(root, 'part.scad'))
    await symlink(path.join(root, 'outside'), path.join(root, 'linked'), 'dir')
    const names: string[] = await Array.fromAsync(
      nodeProjectDetectIo.files(root, MAKER_DETECT_MAX_FILES),
    )
    expect(names).not.toContain('part.scad')
    expect(names).not.toContain('linked/CMakeLists.txt')
    expect(
      await nodeProjectDetectIo.read(root, 'part.scad', MAKER_DETECT_MAX_BYTES),
    ).toBeUndefined()
    expect(
      await nodeProjectDetectIo.read(root, '../package.json', MAKER_DETECT_MAX_BYTES),
    ).toBeUndefined()
  })

  it('counts ignored entries and directories towards the name budget and limits depth', async () => {
    const root = await workspace(
      Object.fromEntries(
        Array.from({ length: MAKER_DETECT_MAX_FILES + 1 }, (_, i) => [
          `node_modules/${String(i)}/part.scad`,
          'cube(1);',
        ]),
      ),
    )
    await writeFile(path.join(root, 'plain.txt'), 'hello')
    const names: string[] = await Array.fromAsync(nodeProjectDetectIo.files(root, 1))
    expect(names.length).toBeLessThanOrEqual(1)
    expect(names.every((name) => !name.startsWith('node_modules/'))).toBe(true)
    expect(await Array.fromAsync(nodeProjectDetectIo.files(root, MAKER_DETECT_MAX_FILES))).toEqual([
      'plain.txt',
    ])
    const deep = await workspace({
      [`${'deep/'.repeat(MAKER_DETECT_MAX_DEPTH + 1)}part.scad`]: 'cube(1);',
    })
    const deepResult = await detectProjectKinds(deep, process.platform)
    expect(deepResult.kinds).toEqual([])
  })

  it('does not offer markers from dependencies or generated output', async () => {
    const root = await workspace({
      'node_modules/package/part.scad': 'cube(1);',
      'build/generated.scad': 'cube(2);',
    })
    const result = await detectProjectKinds(root, process.platform)
    expect(result.kinds).toEqual([])
  })

  it('consumes at most the name cap even if an injected listing ignores its contract', async () => {
    let names = 0
    let reads = 0
    const io: ProjectDetectIo = {
      async *files() {
        await Promise.resolve()
        for (let i = 0; i < MAKER_DETECT_MAX_FILES + 1; i += 1) {
          names += 1
          yield i === MAKER_DETECT_MAX_FILES ? 'hidden.scad' : `${String(i)}.txt`
        }
      },
      read: () => {
        reads += 1
        return Promise.resolve(undefined)
      },
    }
    const result = await detectProjectKinds('/ws', 'linux', io)
    expect(result.kinds).toEqual([])
    expect(names).toBe(MAKER_DETECT_MAX_FILES)
    expect(reads).toBe(0)
  })

  it('reads only the byte cap, cannot detect a marker after it, and rejects malformed text', async () => {
    const root = await workspace({
      'main.py': `${'#'.repeat(MAKER_DETECT_MAX_BYTES)}\nimport board\n`,
    })
    const bytes = await nodeProjectDetectIo.read(root, 'main.py', MAKER_DETECT_MAX_BYTES)
    expect(bytes?.length).toBe(MAKER_DETECT_MAX_BYTES)
    const result = await detectProjectKinds(root, process.platform)
    expect(result.kinds).toEqual([])
    await writeFile(path.join(root, 'main.py'), Buffer.from([0xff, 0, 0x62]))
    const malformed = await detectProjectKinds(root, process.platform)
    expect(malformed.kinds).toEqual([])
  })

  it('refuses escaped, absolute, option-like and Windows device names before reading', async () => {
    const readNames: string[] = []
    const io: ProjectDetectIo = {
      async *files() {
        await Promise.resolve()
        yield '../out/CMakeLists.txt'
        yield 'C:/ws/absolute.py'
        yield 'nul/package.xml'
        yield '-option.py'
        yield 'line\nbreak.py'
      },
      read: (_root, name) => {
        readNames.push(name)
        return Promise.resolve(undefined)
      },
    }
    const result = await detectProjectKinds('C:/ws', 'win32', io)
    expect(result.kinds).toEqual([])
    expect(readNames).toEqual([])
  })

  it('refuses a directory and a special file without opening them', async () => {
    const root = await workspace({ 'folder/ordinary.txt': 'hello' })
    expect(await nodeProjectDetectIo.read(root, 'folder', MAKER_DETECT_MAX_BYTES)).toBeUndefined()
    if (process.platform === 'win32') return
    await symlink('/dev/null', path.join(root, 'main.py'))
    expect(await nodeProjectDetectIo.read(root, 'main.py', MAKER_DETECT_MAX_BYTES)).toBeUndefined()
  })

  it('refuses a regular file behind a directory link outside the workspace', async () => {
    const root = await workspace({})
    const outside = await workspace({ 'main.py': 'import board' })
    await symlink(outside, path.join(root, 'linked'), 'dir')
    expect(
      await nodeProjectDetectIo.read(root, 'linked/main.py', MAKER_DETECT_MAX_BYTES),
    ).toBeUndefined()
  })
})
