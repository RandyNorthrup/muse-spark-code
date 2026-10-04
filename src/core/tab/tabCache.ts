// The typing-through cache (M94, PLAN.md D73; Continue's design): an LRU of
// `TAB_CACHE_ENTRIES` entries keyed by the document's raw prefix — the same
// key reads and writes, never the compiled request — plus the open requests
// a newer trigger can wait for instead of sending another. Pure: no
// `vscode` import.

import { TAB_CACHE_ENTRIES } from '../../shared/constants'

export interface TabCacheEntry {
  readonly document: string
  readonly prefix: string
  readonly suffix: string
  readonly completion: string
}

interface TabOpenRequest {
  readonly document: string
  readonly prefix: string
  readonly suffix: string
}

/** The entry's key: the document and its raw prefix, nothing compiled. */
function entryKey(document: string, prefix: string): string {
  return JSON.stringify([document, prefix])
}

export class TabCache {
  private readonly entries = new Map<string, TabCacheEntry>()
  private readonly open = new Map<string, TabOpenRequest>()

  /** The answered completion, for typing through and partial accept. */
  public store(document: string, prefix: string, suffix: string, completion: string): void {
    if (completion === '') {
      return
    }
    const key = entryKey(document, prefix)
    this.entries.delete(key)
    this.entries.set(key, { document, prefix, suffix, completion })
    while (this.entries.size > TAB_CACHE_ENTRIES) {
      const oldest = this.entries.keys().next()
      if (oldest.done === true) {
        break
      }
      this.entries.delete(oldest.value)
    }
  }

  /**
   * The rest of the longest-prefix entry the current prefix starts with
   * (same document, same suffix), served only when the text typed since
   * that prefix starts the entry's completion. A hit refreshes the entry;
   * anything else — a skipped prefix check would serve stale text — sends
   * nothing here (undefined).
   */
  public lookup(document: string, prefix: string, suffix: string): string | undefined {
    let best: TabCacheEntry | undefined
    for (const entry of this.entries.values()) {
      if (entry.document !== document || entry.suffix !== suffix) {
        continue
      }
      if (!prefix.startsWith(entry.prefix)) {
        continue
      }
      if (best === undefined || entry.prefix.length > best.prefix.length) {
        best = entry
      }
    }
    if (best === undefined) {
      return undefined
    }
    const typed = prefix.slice(best.prefix.length)
    if (!best.completion.startsWith(typed)) {
      return undefined
    }
    this.entries.delete(entryKey(best.document, best.prefix))
    this.entries.set(entryKey(best.document, best.prefix), best)
    return best.completion.slice(typed.length)
  }

  /** A request sent for this prefix, still streaming. */
  public noteOpen(id: string, document: string, prefix: string, suffix: string): void {
    this.open.set(id, { document, prefix, suffix })
  }

  /**
   * An open request the trigger extends (same document and suffix) whose
   * streamed text so far starts what was typed since it opened: wait for
   * it instead of sending another. The longest such request wins.
   */
  public findOpen(
    document: string,
    prefix: string,
    suffix: string,
    streamed: string,
  ): string | undefined {
    let match: string | undefined
    let longest = -1
    for (const [id, request] of this.open) {
      if (request.document !== document || request.suffix !== suffix) {
        continue
      }
      if (!prefix.startsWith(request.prefix)) {
        continue
      }
      if (!streamed.startsWith(prefix.slice(request.prefix.length))) {
        continue
      }
      if (request.prefix.length > longest) {
        longest = request.prefix.length
        match = id
      }
    }
    return match
  }

  /** An open request's answer, into the cache; a failure drops it. */
  public settleOpen(id: string, completion: string): void {
    const request = this.open.get(id)
    this.open.delete(id)
    if (request !== undefined) {
      this.store(request.document, request.prefix, request.suffix, completion)
    }
  }

  public dropOpen(id: string): void {
    this.open.delete(id)
  }

  public get entryCount(): number {
    return this.entries.size
  }

  public get openCount(): number {
    return this.open.size
  }
}
