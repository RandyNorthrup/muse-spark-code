export interface TeamWait {
  holder: string
  kind: 'lease' | 'dependency' | 'child' | 'slot'
}
export type WaitResult = { kind: 'accepted' } | { kind: 'cycle'; cycle: string[] }

/** All four kinds share one graph. Refusal is atomic: the existing waits
 * remain intact when a newer wait would close a cycle. */
export class WaitForGraph {
  private readonly waits = new Map<string, readonly TeamWait[]>()

  private path(
    graph: ReadonlyMap<string, readonly TeamWait[]>,
    from: string,
    to: string,
    seen: Set<string>,
  ): string[] | undefined {
    if (from === to) return [to]
    if (seen.has(from)) return undefined
    seen.add(from)
    const waits = graph.get(from) ?? []
    for (const wait of waits) {
      const tail = this.path(graph, wait.holder, to, seen)
      if (tail !== undefined) return [from, ...tail]
    }
    return undefined
  }

  replace(waiter: string, waits: readonly TeamWait[]): WaitResult {
    const next = new Map(this.waits)
    next.set(waiter, waits)
    for (const wait of waits) {
      const path = this.path(next, wait.holder, waiter, new Set())
      if (path !== undefined) return { kind: 'cycle', cycle: [waiter, ...path] }
    }
    this.waits.set(waiter, [...waits])
    return { kind: 'accepted' }
  }

  add(waiter: string, wait: TeamWait): WaitResult {
    return this.replace(waiter, [...(this.waits.get(waiter) ?? []), wait])
  }

  holdersOf(waiter: string): readonly TeamWait[] {
    return this.waits.get(waiter) ?? []
  }

  remove(task: string): void {
    this.waits.delete(task)
    for (const [waiter, waits] of this.waits)
      this.waits.set(
        waiter,
        waits.filter((wait) => wait.holder !== task),
      )
  }
}
