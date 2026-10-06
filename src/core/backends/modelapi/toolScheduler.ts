import {
  CODE_INTEL_TOOLS,
  IDE_MCP_TOOL_DIAGNOSTICS,
  MODEL_API_PARALLEL_READS,
  MODEL_API_TOOLS,
} from '../../../shared/constants'

// Deliberately excludes server-supplied readOnlyHint, shell and rename.
const PARALLEL_TOOLS = new Set<string>([
  MODEL_API_TOOLS.readFile,
  MODEL_API_TOOLS.listFiles,
  MODEL_API_TOOLS.search,
  MODEL_API_TOOLS.recallOutput,
  CODE_INTEL_TOOLS.findDefinition,
  CODE_INTEL_TOOLS.findReferences,
  CODE_INTEL_TOOLS.workspaceSymbols,
  CODE_INTEL_TOOLS.documentSymbols,
  CODE_INTEL_TOOLS.hover,
  CODE_INTEL_TOOLS.callHierarchy,
  CODE_INTEL_TOOLS.repoMap,
  `mcp__ide__${IDE_MCP_TOOL_DIAGNOSTICS}`,
])

export function isParallelRead(name: string): boolean {
  return PARALLEL_TOOLS.has(name)
}

/** Only execution overlaps. Preparation and settlement always run in call order. */
export async function scheduleTools<Call, Prepared, Result>(options: {
  readonly calls: readonly Call[]
  readonly parallel: boolean
  readonly isRead: (call: Call) => boolean
  readonly prepare: (call: Call) => Promise<Prepared>
  readonly canParallel: (prepared: Prepared) => boolean
  readonly run: (prepared: Prepared) => Promise<Result>
  /** False ends the batch; every remaining call still receives its skipped output. */
  readonly settle: (prepared: Prepared, result: PromiseSettledResult<Result>) => Promise<boolean>
  readonly skip: (call: Call, prepared: Prepared | undefined) => void
}): Promise<{ readonly isComplete: boolean }> {
  const prepared = new Map<number, Prepared>()
  let settled = 0
  let cursor = 0
  const limit = options.parallel ? MODEL_API_PARALLEL_READS : 1
  const prepareGroup = async () => {
    const group: Prepared[] = []
    let barrier: Prepared | undefined
    while (cursor < options.calls.length && group.length < limit) {
      const call = options.calls[cursor]
      if (call === undefined) break
      const isRead = options.parallel && options.isRead(call)
      if (!isRead && group.length > 0) break
      const entry = await options.prepare(call)
      prepared.set(cursor, entry)
      cursor += 1
      if (!isRead || !options.canParallel(entry)) {
        barrier = entry
        break
      }
      group.push(entry)
    }
    return { group, barrier }
  }
  try {
    while (cursor < options.calls.length) {
      const { group, barrier } = await prepareGroup()
      // All executions finish before any settlement; no promise rejection is
      // left unobserved, including when Stop or a post hook ends this batch.
      const results = await Promise.allSettled(group.map((entry) => options.run(entry)))
      for (const [index, entry] of group.entries()) {
        const result = results[index]
        if (result === undefined) throw new Error('missing tool result')
        prepared.delete(settled)
        settled += 1
        const shouldContinue = await options.settle(entry, result)
        if (!shouldContinue) return { isComplete: false }
      }
      if (barrier === undefined) continue
      const [result] = await Promise.allSettled([options.run(barrier)])
      prepared.delete(settled)
      settled += 1
      const shouldContinue = await options.settle(barrier, result)
      if (!shouldContinue) return { isComplete: false }
    }
    return { isComplete: true }
  } finally {
    for (const [index, call] of options.calls.entries()) {
      if (index >= settled) options.skip(call, prepared.get(index))
    }
  }
}
