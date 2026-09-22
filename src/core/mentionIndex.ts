// The searchable list of workspace paths behind the `@` mention menu. The
// file list comes from an injected lister (git or VS Code's file search, see
// src/host/mention/workspaceFiles.ts), is cached for a short TTL because the
// menu queries on every keystroke, and is ranked with the fuzzy scorer.

import type { MentionItem } from '../shared/protocol'
import { rankMatches } from './fuzzy'
import type { CoreLogger } from './logging'

export interface MentionIndexDeps {
  readonly listFiles: () => Promise<readonly string[]>
  readonly now: () => number
  readonly ttlMs: number
  /** Paths beyond this many are dropped (with a warning) to bound search time. */
  readonly limit: number
  readonly log: CoreLogger
}

interface CachedIndex {
  readonly items: readonly MentionItem[]
  readonly builtAt: number
}

/** Files plus every ancestor folder (`dir/`), folders first within ties. */
export function buildMentionItems(files: readonly string[]): readonly MentionItem[] {
  const folders = new Set<string>()
  for (const file of files) {
    let slash = file.indexOf('/')
    while (slash !== -1) {
      folders.add(file.slice(0, slash + 1))
      slash = file.indexOf('/', slash + 1)
    }
  }
  return [
    ...[...folders].map((path) => ({ path, isFolder: true })),
    ...files.map((path) => ({ path, isFolder: false })),
  ]
}

export class MentionIndex {
  private cache: CachedIndex | undefined
  private inflight: Promise<readonly MentionItem[]> | undefined

  public constructor(private readonly deps: MentionIndexDeps) {}

  private async load(): Promise<readonly MentionItem[]> {
    const now = this.deps.now()
    if (this.cache !== undefined && now - this.cache.builtAt < this.deps.ttlMs) {
      return this.cache.items
    }
    this.inflight ??= this.rebuild()
    try {
      return await this.inflight
    } finally {
      this.inflight = undefined
    }
  }

  private async rebuild(): Promise<readonly MentionItem[]> {
    const files = await this.deps.listFiles()
    const kept = files.length > this.deps.limit ? files.slice(0, this.deps.limit) : files
    if (kept.length < files.length) {
      this.deps.log.warn(
        `Mention index truncated to ${String(this.deps.limit)} of ${String(files.length)} paths`,
      )
    }
    const items = buildMentionItems(kept)
    this.cache = { items, builtAt: this.deps.now() }
    return items
  }

  public async search(query: string, limit: number): Promise<readonly MentionItem[]> {
    const items = await this.load()
    return rankMatches(query, items, (item) => item.path, limit)
  }

  /** Forget the cached list (a workspace file changed). */
  public invalidate(): void {
    this.cache = undefined
  }
}
