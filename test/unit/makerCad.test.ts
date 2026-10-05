import capture from '../fixtures/maker/kicad-drc.json'
import ercCapture from '../fixtures/maker/kicad-erc.json'
import { Buffer } from 'node:buffer'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CadTools,
  inspectStl,
  summarizeKicadReport,
  type CadPolicy,
  type CadRunner,
} from '../../src/core/maker/cad'

const stlPolicy = { maxBytes: 10_000, maxTriangles: 100, maxAbsCoordinate: 1000 }
function binaryTriangle() {
  const bytes = Buffer.alloc(134)
  bytes.writeUInt32LE(1, 80)
  const vertices = [0, 0, 0, 10, 0, 0, 0, 20, 5]
  for (const [index, value] of vertices.entries()) bytes.writeFloatLE(value, 96 + index * 4)
  return bytes
}
const ascii =
  'solid triangle\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 10 0 0\nvertex 0 20 5\nendloop\nendfacet\nendsolid triangle\n'
const directories: string[] = []
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true })
})

describe('maker STL validation', () => {
  it('validates the captured OpenSCAD cube with twelve triangles', () => {
    const bytes = readFileSync(new URL('../fixtures/maker/openscad-cube.stl', import.meta.url))
    expect(inspectStl(bytes, stlPolicy)).toEqual({
      triangles: 12,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 5 } },
    })
  })
  it('computes actual vertex bounds for binary and ASCII triangles', () => {
    const expected = {
      triangles: 1,
      bounds: { min: { x: 0, y: 0, z: 0 }, max: { x: 10, y: 20, z: 5 } },
    }
    expect(inspectStl(binaryTriangle(), stlPolicy)).toEqual(expected)
    expect(inspectStl(Buffer.from(ascii), stlPolicy)).toEqual(expected)
    const solidHeader = binaryTriangle()
    solidHeader.write('solid also binary')
    expect(inspectStl(solidHeader, stlPolicy)).toEqual(expected)
  })
  it('refuses byte and triangle budgets before allocating a preview', () => {
    const oversized = Buffer.alloc(10_001)
    const copy = vi.spyOn(Buffer, 'from')
    expect(() => inspectStl(oversized, stlPolicy)).toThrow('stlSize')
    expect(copy).not.toHaveBeenCalled()
    copy.mockRestore()
    expect(() => inspectStl(binaryTriangle(), { ...stlPolicy, maxTriangles: 0 })).toThrow('stlSize')
    expect(() => inspectStl(Buffer.from(ascii), { ...stlPolicy, maxTriangles: 0 })).toThrow(
      'stlSize',
    )
  })
  it('refuses nonfinite or excessive bounds, missing vertices and trailing junk', () => {
    const nonfinite = binaryTriangle()
    nonfinite.writeFloatLE(NaN, 96)
    expect(() => inspectStl(nonfinite, stlPolicy)).toThrow('stlBounds')
    const normal = binaryTriangle()
    normal.writeFloatLE(Infinity, 84)
    expect(() => inspectStl(normal, stlPolicy)).toThrow('stlSyntax')
    expect(() => inspectStl(binaryTriangle(), { ...stlPolicy, maxAbsCoordinate: 1 })).toThrow(
      'stlBounds',
    )
    for (const malformed of [
      ascii.replace('vertex 10 0 0\n', ''),
      ascii.replace('outer loop', 'junk'),
      ascii.replace('vertex 0 0 0', 'vertex NaN 0 0'),
      `${ascii}junk`,
      'solid empty\nendsolid empty',
    ]) {
      expect(() => inspectStl(Buffer.from(malformed), stlPolicy)).toThrow()
    }
    expect(() => inspectStl(binaryTriangle().subarray(0, 100), stlPolicy)).toThrow('stlSyntax')
  })
})
const report = {
  violations: [{ severity: 'error', description: 'Missing board outline' }],
  unconnected_items: [{ severity: 'warning', description: 'Unconnected pad' }],
  schematic_parity: [],
}
async function fixture(canViewImages = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'maker-cad-'))
  directories.push(directory)
  const workspace = path.join(directory, 'workspace'),
    output = path.join(directory, 'output')
  await mkdir(workspace)
  await writeFile(path.join(workspace, 'cube.scad'), 'cube(10);')
  await writeFile(path.join(workspace, 'board.kicad_pcb'), '(kicad_pcb)')
  await writeFile(path.join(workspace, 'board.kicad_sch'), '(kicad_sch)')
  const policy: CadPolicy = {
    stl: stlPolicy,
    maxSourceBytes: 1000,
    maxImageBytes: 10_000,
    maxReportBytes: 10_000,
    maxOutputBytes: 1000,
    timeoutMs: 1000,
    imageWidth: 1,
    imageHeight: 1,
    openscad: '/trusted/openscad',
    kicad: '/trusted/kicad-cli',
  }
  const run = vi.fn<CadRunner['run']>(async (_executable, args) => {
    const destination = args[args.indexOf(args.includes('-o') ? '-o' : '--output') + 1]
    if (destination === undefined) throw new Error('missingOutput')
    if (destination.endsWith('.stl')) await writeFile(destination, binaryTriangle())
    else if (destination.endsWith('.png'))
      await writeFile(
        destination,
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLttAAAAABJRU5ErkJggg==',
          'base64',
        ),
      )
    else await writeFile(destination, JSON.stringify(report))
    return { exitCode: 0, stdout: '', stderr: '' }
  })
  const tools = new CadTools(workspace, output, {
    runner: { run },
    policy,
    canViewImages: () => canViewImages,
  })
  return { tools, run, workspace, output, policy }
}
describe('maker CAD and EDA runners', () => {
  it('runs OpenSCAD without a shell and returns checked STL and PNG only for vision', async () => {
    const { tools, run, output } = await fixture()
    const result = await tools.renderOpenScad('cube.scad', new AbortController().signal)
    expect(result.summary.triangles).toBe(1)
    expect(result.png).toBeDefined()
    expect(run.mock.calls[0]?.[2].configurationDirectory).toBe(path.join(output, 'configuration'))
    expect(
      run.mock.calls.map(([executable, args]) => ({ executable, flags: args.slice(0, 2) })),
    ).toEqual([
      { executable: '/trusted/openscad', flags: ['--export-format', 'binstl'] },
      { executable: '/trusted/openscad', flags: ['--render', '--imgsize=1,1'] },
    ])
    const noVision = await fixture(false)
    const nonvisual = await noVision.tools.renderOpenScad('cube.scad', new AbortController().signal)
    expect(nonvisual.png).toBeUndefined()
    expect(noVision.run).toHaveBeenCalledTimes(1)
  })
  it('drops images when the selected model loses vision while rendering', async () => {
    const { workspace, output, run, policy } = await fixture()
    let isVision = true
    const tools = new CadTools(workspace, output, {
      runner: { run },
      policy,
      canViewImages: () => isVision,
    })
    const original = run.getMockImplementation()!
    run.mockImplementation(async (executable, args, options) => {
      const result = await original(executable, args, options)
      if (args.includes('--render')) isVision = false
      return result
    })
    const rendered = await tools.renderOpenScad('cube.scad', new AbortController().signal)
    expect(rendered.png).toBeUndefined()
  })
  it('summarizes the captured KiCad 9.0.8 report', () => {
    expect(summarizeKicadReport(capture)).toEqual({
      errors: 1,
      warnings: 0,
      descriptions: [capture.violations[0]!.description],
    })
  })
  it('parses actual ERC sheet grouping and counts violations across sheets', () => {
    expect(summarizeKicadReport(ercCapture)).toEqual({ errors: 0, warnings: 0, descriptions: [] })
    expect(
      summarizeKicadReport({
        sheets: [
          { violations: [{ severity: 'error', description: 'Open pin' }] },
          { violations: [{ severity: 'warning', description: 'Label' }] },
        ],
      }),
    ).toEqual({ errors: 1, warnings: 1, descriptions: ['Open pin', 'Label'] })
    expect(() =>
      summarizeKicadReport({
        sheets: [{ violations: [{ severity: 'unknown', description: 'bad' }] }],
      }),
    ).toThrow()
  })
  it('validates reports and includes unconnected/parity problems', async () => {
    const { tools, run } = await fixture()
    expect(await tools.checkKicad('board.kicad_pcb', 'pcb', new AbortController().signal)).toEqual({
      errors: 1,
      warnings: 1,
      descriptions: ['Missing board outline', 'Unconnected pad'],
    })
    await tools.checkKicad('board.kicad_sch', 'sch', new AbortController().signal)
    expect(run.mock.calls[0]?.[1].slice(0, 4)).toEqual(['pcb', 'drc', '--format', 'json'])
    expect(run.mock.calls[1]?.[1].slice(0, 4)).toEqual(['sch', 'erc', '--format', 'json'])
    expect(() => summarizeKicadReport({ violations: [{ severity: 'error' }] })).toThrow()
    expect(() => summarizeKicadReport({})).toThrow()
  })
  it('refuses sources outside the workspace, wrong extensions and oversized inputs', async () => {
    const { tools, workspace, run } = await fixture()
    await writeFile(path.join(workspace, '..', 'outside.scad'), 'cube(1);')
    await expect(
      tools.renderOpenScad('../outside.scad', new AbortController().signal),
    ).rejects.toThrow('cadSource')
    await expect(
      tools.renderOpenScad('board.kicad_pcb', new AbortController().signal),
    ).rejects.toThrow('cadSource')
    await symlink(path.join(workspace, '..', 'outside.scad'), path.join(workspace, 'linked.scad'))
    await expect(tools.renderOpenScad('linked.scad', new AbortController().signal)).rejects.toThrow(
      'cadSource',
    )
    await mkdir(path.join(workspace, 'folder.scad'))
    await expect(tools.renderOpenScad('folder.scad', new AbortController().signal)).rejects.toThrow(
      'cadFileSize',
    )
    await writeFile(path.join(workspace, 'cube.scad'), 'x'.repeat(1001))
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'cadFileSize',
    )
    expect(run).not.toHaveBeenCalled()
  })
  it('does not accept a failed, missing, malformed, oversized or stale success artifact', async () => {
    const { tools, run } = await fixture()
    await tools.renderOpenScad('cube.scad', new AbortController().signal)
    run.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow()
    run.mockResolvedValue({ exitCode: 1, stdout: '', stderr: '' })
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'cadProcessFailed',
    )
    run.mockResolvedValue({ exitCode: 0, stdout: 'x'.repeat(1001), stderr: '' })
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'cadOutputSize',
    )
    run.mockImplementation(async (_executable, args) => {
      const destination = args[args.indexOf('-o') + 1]!
      await writeFile(destination, Buffer.alloc(10_001))
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'cadFileSize',
    )
  })
  it('bounds a runner that never settles and refuses a malformed PNG', async () => {
    const { workspace, output, policy } = await fixture()
    let cancellation: AbortSignal | undefined
    const forever: CadRunner = {
      run: (_executable, _args, options) => {
        cancellation = options.signal
        return new Promise(() => undefined)
      },
    }
    const bounded = new CadTools(workspace, output, {
      runner: forever,
      policy: { ...policy, timeoutMs: 20 },
      canViewImages: () => true,
    })
    await expect(bounded.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'machineDeadline',
    )
    expect(cancellation?.aborted).toBe(true)
    const { tools, run } = await fixture()
    run.mockImplementation(async (_executable, args) => {
      const destination = args[args.indexOf('-o') + 1]!
      await writeFile(
        destination,
        destination.endsWith('.stl') ? binaryTriangle() : Buffer.from('not PNG'),
      )
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await expect(tools.renderOpenScad('cube.scad', new AbortController().signal)).rejects.toThrow(
      'cadImage',
    )
  })
})
