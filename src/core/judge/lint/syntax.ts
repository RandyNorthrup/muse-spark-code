import * as z from 'zod/mini'
import type { LintFunction } from './context'
import { lintKinds, type LintFile, type LintKind, type LintUnit } from './units'

const indexSchema = z.int().check(z.gte(-1))
const captureSchema = z.record(z.string(), z.int().check(z.nonnegative()))
const syntaxSchema = z.strictObject({
  hasError: z.boolean(),
  nodes: z.array(
    z.strictObject({
      kind: z.string(),
      startByte: z.int().check(z.nonnegative()),
      endByte: z.int().check(z.nonnegative()),
      parent: indexSchema,
      previous: indexSchema,
    }),
  ),
  queries: z.strictObject({
    function: z.array(captureSchema),
    type: z.array(captureSchema),
    context: z.array(captureSchema),
    call: z.array(captureSchema),
  }),
  regionKinds: z.record(z.string(), z.enum(lintKinds)),
})

/** The installed parser supplies named nodes and real query matches, never inferred syntax. */
export function readLintSyntax(file: LintFile, raw: unknown, maxRegions: number) {
  const syntax = syntaxSchema.parse(raw)
  if (syntax.hasError || !Number.isSafeInteger(maxRegions) || maxRegions < 1) {
    throw new Error('lint-extraction-invalid')
  }
  const offsets = new Map<number, number>([[0, 0]])
  let bytes = 0
  let offset = 0
  for (const character of file.source) {
    bytes += Buffer.byteLength(character)
    offset += character.length
    offsets.set(bytes, offset)
  }
  const nodes = syntax.nodes.map((node, index) => {
    const start = offsets.get(node.startByte)
    const end = offsets.get(node.endByte)
    if (
      start === undefined ||
      end === undefined ||
      end < start ||
      node.parent >= index ||
      node.previous >= index
    ) {
      throw new Error('lint-extraction-invalid')
    }
    return { ...node, start, end }
  })
  for (const node of nodes) {
    const parent = nodes[node.parent]
    const previous = nodes[node.previous]
    if (
      (parent !== undefined && (node.start < parent.start || node.end > parent.end)) ||
      (previous !== undefined && (previous.parent !== node.parent || previous.end > node.start))
    ) {
      throw new Error('lint-extraction-invalid')
    }
  }
  const nodeFor = (index: number | undefined) => {
    const node = index === undefined ? undefined : nodes[index]
    if (node === undefined) throw new Error('lint-extraction-invalid')
    return node
  }
  const declarations = (matches: readonly Record<string, number>[], kind: 'function' | 'type') =>
    matches.flatMap((captures) => {
      for (const index of Object.values(captures)) nodeFor(index)
      if (captures[kind] === undefined || captures['name'] === undefined) return []
      const node = nodeFor(captures[kind])
      const name = nodeFor(captures['name'])
      const parent = nodes[node.parent]
      const anchor = parent?.kind === 'decorated_definition' ? parent : node
      let start = anchor.start
      let previous = nodes[anchor.previous]
      while (previous !== undefined && syntax.regionKinds[previous.kind] === 'comment') {
        const gap = file.source.slice(previous.end, start)
        if (!/^[ \t\r\n]*$/.test(gap) || gap.split('\n').length > 2) break
        start = previous.start
        previous = nodes[previous.previous]
      }
      return {
        unit: { kind, name: file.source.slice(name.start, name.end), start, end: node.end },
        docStart: anchor.start,
      }
    })
  const functions = declarations(syntax.queries.function, 'function')
  const types = declarations(syntax.queries.type, 'type')
  const contextTypes = [...types, ...declarations(syntax.queries.context, 'type')]
  for (const item of functions) {
    const source = file.source.slice(item.unit.start, item.unit.end)
    const related = contextTypes
      .filter(({ unit }) => {
        if (unit.start <= item.unit.start && unit.end >= item.unit.end) return true
        for (
          let start = source.indexOf(unit.name);
          start >= 0;
          start = source.indexOf(unit.name, start + unit.name.length)
        ) {
          if (!unit.name) break
          const before = source[start - 1] ?? ''
          const after = source[start + unit.name.length] ?? ''
          if (!/[a-zA-Z0-9_]/.test(before) && !/[a-zA-Z0-9_]/.test(after)) return true
        }
        return false
      })
      .map(({ unit }) => ({ name: unit.name, source: file.source.slice(unit.start, unit.end) }))
    if (related.length > 0) Object.assign(item.unit, { types: related })
  }
  const base = [...functions, ...types].toSorted(
    (left, right) => left.unit.start - right.unit.start || (left.unit.kind === 'type' ? -1 : 1),
  )
  const regions = nodes
    .flatMap((node) => {
      let kind = syntax.regionKinds[node.kind]
      if (kind === undefined || node.end <= node.start) return []
      if (
        kind === 'comment' &&
        base.some(
          ({ unit, docStart }) =>
            docStart > unit.start && node.start >= unit.start && node.end <= docStart,
        )
      )
        kind = 'docComment'
      return { kind, regionKind: node.kind, start: node.start, end: node.end }
    })
    .toSorted((left, right) => left.start - right.start || left.end - right.end)
  const localized = (unit: LintUnit): LintUnit[] =>
    regions
      .filter((region) => region.start >= unit.start && region.end <= unit.end)
      .slice(0, maxRegions)
      .map((region) => ({
        ...region,
        name: `${unit.name}:${region.regionKind}`,
        parentSource: file.source.slice(unit.start, unit.end),
        ...(unit.types !== undefined && { types: unit.types }),
      }))
  const selected = new Map<string, { parent: LintUnit; region: LintUnit }>()
  for (const { unit } of base) {
    for (const region of localized(unit)) {
      const key = JSON.stringify([region.kind, region.regionKind, region.start, region.end])
      const current = selected.get(key)
      if (
        current === undefined ||
        current.parent.end - current.parent.start > unit.end - unit.start
      ) {
        selected.set(key, { parent: unit, region })
      }
    }
  }
  const calls = syntax.queries.call.map((capture) => {
    const node = nodeFor(capture['call'])
    const spelling = file.source.slice(node.start, node.end).trim()
    const dot = spelling.lastIndexOf('.')
    const isQualified = dot > 0 && dot < spelling.length - 1
    return {
      start: node.start,
      end: node.end,
      name: isQualified ? spelling.slice(dot + 1) : spelling,
      path: isQualified ? spelling.slice(0, dot) : '',
    }
  })
  const inventory: LintFunction[] = functions.map(({ unit }) => {
    const direct = calls.filter(
      (call) =>
        call.name &&
        call.start >= unit.start &&
        call.end <= unit.end &&
        functions.every(
          ({ unit: inner }) =>
            !(
              inner !== unit &&
              inner.start >= unit.start &&
              inner.end <= unit.end &&
              call.start >= inner.start &&
              call.end <= inner.end
            ),
        ),
    )
    const seen = new Set<string>()
    return {
      file,
      unit,
      calls: direct.flatMap(({ name, path }) => {
        const spelling = path ? `${path}.${name}` : name
        if (seen.has(spelling)) return []
        seen.add(spelling)
        return { name, path }
      }),
    }
  })
  const units: LintUnit[] = base.map(({ unit }) => unit)
  for (const { region } of selected.values()) units.push(region)
  const order: readonly LintKind[] = [
    'type',
    'function',
    'comment',
    'docComment',
    'field',
    'statement',
  ]
  return {
    units: units.toSorted(
      (left, right) =>
        left.start - right.start || order.indexOf(left.kind) - order.indexOf(right.kind),
    ),
    functions: inventory,
    localize: localized,
  }
}
