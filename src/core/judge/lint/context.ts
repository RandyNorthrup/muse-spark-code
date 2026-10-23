import * as z from 'zod/mini'
import type { LintLimits } from './evaluate'
import type { LintFile, LintUnit } from './units'

const callsSchema = z.array(z.strictObject({ name: z.string(), path: z.string() }))
export interface LintFunction {
  readonly file: LintFile
  readonly unit: LintUnit
  /** Bare/qualified names captured by the installed grammar, at depth one. */
  readonly calls: unknown
}

/** Inputs are exclusively the caller's authorized project files, never an external index. */
export function resolveLintCallees(
  caller: LintFunction,
  functions: readonly LintFunction[],
  limits: Pick<LintLimits, 'maxCallees' | 'maxCalleeBytes'>,
): readonly { readonly name: string; readonly path: string; readonly source: string }[] {
  const calls = callsSchema.parse(caller.calls)
  const callees: { name: string; path: string; source: string }[] = []
  const seen = new Set<string>()
  let bytes = 0
  for (const call of calls) {
    // Upstream refuses qualified calls and recursion: bare-name matching cannot bind receivers.
    if (call.path || !call.name || call.name === caller.unit.name) continue
    const candidates = functions.filter(
      (target) => target.unit.kind === 'function' && target.unit.name === call.name,
    )
    const sameFile = candidates.filter((target) => target.file.path === caller.file.path)
    const pool = sameFile.length > 0 ? sameFile : candidates
    if (pool.length !== 1) continue
    const target = pool[0]
    if (target === undefined) continue
    const { unit, file } = target
    if (unit.start < 0 || unit.end <= unit.start || unit.end > file.source.length) {
      throw new Error('lint-extraction-invalid')
    }
    const source = file.source.slice(unit.start, unit.end)
    const identity = JSON.stringify([file.path, unit.name, source])
    if (seen.has(identity)) continue
    seen.add(identity)
    if (callees.length >= limits.maxCallees) break
    const size = Buffer.byteLength(source, 'utf8')
    if (bytes + size > limits.maxCalleeBytes) continue
    callees.push({ name: unit.name, path: file.path, source })
    bytes += size
  }
  return callees
}
