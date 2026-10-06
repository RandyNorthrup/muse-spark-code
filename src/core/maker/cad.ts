import { withMakerDeadline } from './machines/deadline'
import { Buffer } from 'node:buffer'
import { constants } from 'node:fs'
import { mkdir, open, realpath, mkdtemp, lstat, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import * as z from 'zod/mini'
import { handleIdentity, sameFile, statIdentity } from '../fs/fileIdentity'
import { redactSecrets } from '../../shared/redact'
import { type Bounds, type Point } from './gcode/analyser'
import { MachineError } from './registry'

// Fixed format layout, not tunables. All resource budgets are injected below.
const STL = {
  headerBytes: 80,
  countBytes: 4,
  triangleBytes: 50,
  floatBytes: 4,
  normalFloats: 3,
  vertexFloats: 9,
  asciiFacetLines: 7,
} as const
const PNG = {
  signature: '89504e470d0a1a0a',
  dimensionBytes: 4,
  widthOffset: 16,
  heightOffset: 20,
} as const
export interface StlPolicy {
  readonly maxBytes: number
  readonly maxTriangles: number
  readonly maxAbsCoordinate: number
}
export interface StlSummary {
  readonly triangles: number
  readonly bounds: Bounds
}
function extend(bounds: Bounds | undefined, vertex: Point, policy: StlPolicy): Bounds {
  if (
    [vertex.x, vertex.y, vertex.z].some(
      (value) => !Number.isFinite(value) || Math.abs(value) > policy.maxAbsCoordinate,
    )
  )
    throw new MachineError('stlBounds')
  if (bounds === undefined) return { min: vertex, max: vertex }
  return {
    min: {
      x: Math.min(bounds.min.x, vertex.x),
      y: Math.min(bounds.min.y, vertex.y),
      z: Math.min(bounds.min.z, vertex.z),
    },
    max: {
      x: Math.max(bounds.max.x, vertex.x),
      y: Math.max(bounds.max.y, vertex.y),
      z: Math.max(bounds.max.z, vertex.z),
    },
  }
}
function binaryStl(bytes: Buffer, triangles: number, policy: StlPolicy): StlSummary {
  let bounds: Bounds | undefined
  for (let triangle = 0; triangle < triangles; triangle += 1) {
    const start = STL.headerBytes + STL.countBytes + triangle * STL.triangleBytes
    for (let component = 0; component < STL.normalFloats; component += 1) {
      if (!Number.isFinite(bytes.readFloatLE(start + component * STL.floatBytes)))
        throw new MachineError('stlSyntax')
    }
    for (let vertex = 0; vertex < STL.vertexFloats; vertex += STL.normalFloats) {
      const offset = start + (STL.normalFloats + vertex) * STL.floatBytes
      bounds = extend(
        bounds,
        {
          x: bytes.readFloatLE(offset),
          y: bytes.readFloatLE(offset + STL.floatBytes),
          z: bytes.readFloatLE(offset + 2 * STL.floatBytes),
        },
        policy,
      )
    }
  }
  if (bounds === undefined) throw new MachineError('stlSyntax')
  return { triangles, bounds }
}
function asciiStl(bytes: Buffer, policy: StlPolicy): StlSummary {
  const lines = bytes
    .toString('utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '')
  if (!/^solid(?:\s.*)?$/.test(lines[0] ?? '') || !/^endsolid(?:\s.*)?$/.test(lines.at(-1) ?? ''))
    throw new MachineError('stlSyntax')
  let bounds: Bounds | undefined
  let triangles = 0
  const coordinates = (line: string | undefined, prefix: string): Point => {
    const values = line?.split(/\s+/)
    const words = prefix.split(' ')
    if (
      values?.length !== words.length + STL.normalFloats ||
      words.some((word, index) => values[index] !== word)
    )
      throw new MachineError('stlSyntax')
    const parsed = values
      .slice(words.length)
      .map((word) =>
        /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(word) ? Number(word) : NaN,
      )
    if (parsed.some((value) => !Number.isFinite(value))) throw new MachineError('stlSyntax')
    return z
      .object({ x: z.number(), y: z.number(), z: z.number() })
      .parse({ x: parsed[0], y: parsed[1], z: parsed[2] })
  }
  for (let at = 1; at < lines.length - 1; at += STL.asciiFacetLines) {
    coordinates(lines[at], 'facet normal')
    if (
      lines[at + 1] !== 'outer loop' ||
      lines[at + STL.asciiFacetLines - 2] !== 'endloop' ||
      lines[at + STL.asciiFacetLines - 1] !== 'endfacet'
    )
      throw new MachineError('stlSyntax')
    for (let vertex = 0; vertex < STL.normalFloats; vertex += 1)
      bounds = extend(bounds, coordinates(lines[at + 2 + vertex], 'vertex'), policy)
    triangles += 1
    if (triangles > policy.maxTriangles) throw new MachineError('stlSize')
  }
  if (bounds === undefined) throw new MachineError('stlSyntax')
  return { triangles, bounds }
}
export function inspectStl(data: Uint8Array, policy: StlPolicy): StlSummary {
  if (data.byteLength > policy.maxBytes) throw new MachineError('stlSize')
  const bytes = Buffer.from(data)
  if (bytes.length >= STL.headerBytes + STL.countBytes) {
    const triangles = bytes.readUInt32LE(STL.headerBytes)
    if (bytes.length === STL.headerBytes + STL.countBytes + triangles * STL.triangleBytes) {
      if (triangles === 0 || triangles > policy.maxTriangles) throw new MachineError('stlSize')
      return binaryStl(bytes, triangles, policy)
    }
  }
  return asciiStl(bytes, policy)
}
async function boundedFile(file: string, maxBytes: number, root?: string): Promise<Buffer> {
  const before = await lstat(file)
  if (!before.isFile() || before.size > maxBytes) throw new MachineError('cadFileSize')
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new MachineError('cadFileSize')
    if (root !== undefined) {
      const canonical = await realpath(file)
      const within = path.relative(root, canonical)
      if (
        within === '..' ||
        within.startsWith(`..${path.sep}`) ||
        path.isAbsolute(within) ||
        stat.nlink !== 1 ||
        !sameFile(await handleIdentity(handle), await statIdentity(canonical))
      )
        throw new MachineError('cadSource')
    }
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    while (size < buffer.length) {
      const read = await handle.read(buffer, size, buffer.length - size, size)
      if (read.bytesRead === 0) break
      size += read.bytesRead
    }
    if (size > maxBytes) throw new MachineError('cadFileSize')
    return buffer.subarray(0, size)
  } finally {
    await handle.close()
  }
}
const processResultSchema = z.object({ exitCode: z.int(), stdout: z.string(), stderr: z.string() })
export interface CadRunner {
  /** Host implementation uses process-tree kill, a clean child environment and shell:false.
   * Sets KICAD_CONFIG_HOME/XDG_CONFIG_HOME/XDG_CACHE_HOME under configurationDirectory. */
  run(
    executable: string,
    args: readonly string[],
    options: {
      readonly configurationDirectory: string
      readonly cwd: string
      readonly timeoutMs: number
      readonly maxOutputBytes: number
      readonly signal: AbortSignal
    },
  ): Promise<unknown>
}
export interface CadPolicy {
  readonly stl: StlPolicy
  readonly maxSourceBytes: number
  readonly maxImageBytes: number
  readonly maxReportBytes: number
  readonly maxOutputBytes: number
  readonly timeoutMs: number
  readonly imageWidth: number
  readonly imageHeight: number
  readonly openscad: string
  readonly kicad: string
}
export interface CadDeps {
  readonly runner: CadRunner
  readonly policy: CadPolicy
  readonly canViewImages: () => boolean
}
const violationSchema = z.object({
  severity: z.enum(['error', 'warning', 'info']),
  description: z.string(),
})
const drcReportSchema = z.object({
  violations: z.array(violationSchema),
  unconnected_items: z.optional(z.array(violationSchema)),
  schematic_parity: z.optional(z.array(violationSchema)),
})
const reportSchema = z.union([
  drcReportSchema,
  z.object({ sheets: z.array(z.object({ violations: z.array(violationSchema) })) }),
])
export function summarizeKicadReport(input: unknown): {
  readonly errors: number
  readonly warnings: number
  readonly descriptions: readonly string[]
} {
  const report = reportSchema.parse(input)
  const issues =
    'sheets' in report
      ? report.sheets.flatMap((sheet) => sheet.violations)
      : [
          ...report.violations,
          ...(report.unconnected_items ?? []),
          ...(report.schematic_parity ?? []),
        ]
  return {
    errors: issues.filter((issue) => issue.severity === 'error').length,
    warnings: issues.filter((issue) => issue.severity === 'warning').length,
    descriptions: issues.map((issue) => redactSecrets(issue.description)),
  }
}

/** No executable, argument list or output destination comes from a model tool. */
export class CadTools {
  constructor(
    private readonly workspace: string,
    private readonly outputDirectory: string,
    private readonly deps: CadDeps,
  ) {}
  private async source(relative: string, extension: string): Promise<Buffer> {
    const root = await realpath(this.workspace)
    const file = await realpath(path.resolve(root, relative))
    const within = path.relative(root, file)
    if (
      within === '..' ||
      within.startsWith(`..${path.sep}`) ||
      path.isAbsolute(within) ||
      path.extname(file) !== extension
    )
      throw new MachineError('cadSource')
    return await boundedFile(file, this.deps.policy.maxSourceBytes, root)
  }
  private async run(
    executable: string,
    args: readonly string[],
    signal: AbortSignal,
  ): Promise<void> {
    const output = await withMakerDeadline(
      async (deadline) =>
        await this.deps.runner.run(executable, args, {
          configurationDirectory: path.join(this.outputDirectory, 'configuration'),
          cwd: this.workspace,
          timeoutMs: this.deps.policy.timeoutMs,
          maxOutputBytes: this.deps.policy.maxOutputBytes,
          signal: AbortSignal.any([signal, deadline]),
        }),
      this.deps.policy.timeoutMs,
    )
    const result = processResultSchema.parse(output)
    if (result.exitCode !== 0) throw new MachineError('cadProcessFailed')
    if (
      Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr) >
      this.deps.policy.maxOutputBytes
    )
      throw new MachineError('cadOutputSize')
  }
  async renderOpenScad(
    relative: string,
    signal: AbortSignal,
  ): Promise<{
    readonly stl: Buffer
    readonly summary: StlSummary
    readonly png: Buffer | undefined
  }> {
    const source = await this.source(relative, '.scad')
    await mkdir(this.outputDirectory, { recursive: true })
    // Unique per invocation: never accept an old success artifact after a failed run.
    const folder = await mkdtemp(path.join(this.outputDirectory, 'render-'))
    try {
      // The process reads the checked bytes, never reopens the mutable workspace source.
      const file = path.join(folder, 'source.scad')
      await writeFile(file, source, { flag: 'wx', mode: constants.S_IRUSR })
      const stlFile = path.join(folder, 'model.stl')
      await this.run(
        this.deps.policy.openscad,
        ['--export-format', 'binstl', '-o', stlFile, file],
        signal,
      )
      const stl = await boundedFile(stlFile, this.deps.policy.stl.maxBytes)
      const summary = inspectStl(stl, this.deps.policy.stl)
      let png: Buffer | undefined
      if (this.deps.canViewImages()) {
        const pngFile = path.join(folder, 'model.png')
        await this.run(
          this.deps.policy.openscad,
          [
            '--render',
            `--imgsize=${String(this.deps.policy.imageWidth)},${String(this.deps.policy.imageHeight)}`,
            '-o',
            pngFile,
            file,
          ],
          signal,
        )
        const image = await boundedFile(pngFile, this.deps.policy.maxImageBytes)
        if (
          image.length < PNG.heightOffset + PNG.dimensionBytes ||
          image.subarray(0, PNG.signature.length / 2).toString('hex') !== PNG.signature ||
          image.readUInt32BE(PNG.widthOffset) !== this.deps.policy.imageWidth ||
          image.readUInt32BE(PNG.heightOffset) !== this.deps.policy.imageHeight
        )
          throw new MachineError('cadImage')
        if (this.deps.canViewImages()) png = image
      }
      return { stl, summary, png }
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }
  async checkKicad(
    relative: string,
    kind: 'pcb' | 'sch',
    signal: AbortSignal,
  ): Promise<ReturnType<typeof summarizeKicadReport>> {
    const source = await this.source(relative, kind === 'pcb' ? '.kicad_pcb' : '.kicad_sch')
    await mkdir(this.outputDirectory, { recursive: true })
    const folder = await mkdtemp(path.join(this.outputDirectory, 'check-'))
    try {
      const file = path.join(folder, kind === 'pcb' ? 'source.kicad_pcb' : 'source.kicad_sch')
      await writeFile(file, source, { flag: 'wx', mode: constants.S_IRUSR })
      const reportFile = path.join(folder, 'report.json')
      await this.run(
        this.deps.policy.kicad,
        [kind, kind === 'pcb' ? 'drc' : 'erc', '--format', 'json', '--output', reportFile, file],
        signal,
      )
      const bytes = await boundedFile(reportFile, this.deps.policy.maxReportBytes)
      const parsed: unknown = JSON.parse(bytes.toString('utf8'))
      return summarizeKicadReport(parsed)
    } finally {
      await rm(folder, { recursive: true, force: true })
    }
  }
}
