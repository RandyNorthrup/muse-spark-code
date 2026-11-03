// One session's MCP declarations across its user turns (4-H4): the
// frozen per-turn catalogue, the person's defer threshold, the
// discovered tools and the `tool_search` answer. The host asks this
// for every request's MCP definitions and every admission; it logs and
// shows the words `beginTurn` and `search` return. The pool builds it
// (`McpToolSource.declarations`), so this code loads with the pool's
// lazy bundle, never in the main Model API bundle (D6).
//
// Why freeze per turn: the pool learns a `tools/list` change whenever a
// server sends it (a change notification, a stale listing, a
// reconnect). Applied at once, one turn's requests would carry two
// prefixes; frozen, the prefix changes once, at the next user turn.
// Discoveries still append within the turn, because the model asked.

import { MODEL_API_MODEL_TEXT, UI_TEXT } from '../../../../shared/constants'
import { fill, formatNumber } from '../../../../shared/l10n/text'
import { estimateDefinitionTokens } from '../requestMeters'
import type { FunctionToolDefinition } from '../schemas'
import {
  type DeferralPlan,
  type McpCatalogEntry,
  planDeferral,
  searchCatalog,
  toolSearchDefinition,
} from './deferredTools'
import type { McpPoolSnapshot, McpToolSource } from './pool'

/** What starting a user turn changed, for the host's log and notice (counts only). */
export interface McpTurnStart {
  /** Set when the catalogue really changed since the previous turn. */
  readonly changed: { readonly toolCount: number; readonly definitionTokens: number } | undefined
  /** Set on the first turn deferral applies to this catalogue (said once per catalogue). */
  readonly deferral: DeferralPlan | undefined
  /** The log lines for both (counts only). */
  readonly log: readonly string[]
  /** The transcript notice for a new deferral, in the person's words. */
  readonly notice: string | undefined
}

/** What one `tool_search` call answers: the model's output, the row's words, the log line. */
export type McpSearchAnswer =
  | { readonly kind: 'notDeferred' }
  | {
      readonly kind: 'searched'
      readonly matches: readonly McpCatalogEntry[]
      /** Matches this call loaded (the rest were loaded before). */
      readonly loaded: readonly McpCatalogEntry[]
      readonly output: string
      readonly visibleOutput: string
      readonly log: string
    }

/** A threshold as the planner reads it: a positive safe integer, else 0 (never defer). */
export function deferThreshold(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
The servers of the settings that are not connected now, with their
state (`github (failed), slack (starting)`): what a search that found
nothing names, so a tool missing with its server is said, not silent.
A server the person disabled is their choice and is not named.
*/
export function unconnectedMcpServers(snapshot: McpPoolSnapshot | undefined): string {
  return (snapshot?.servers ?? [])
    .filter((server) => server.state.status !== 'connected' && server.state.status !== 'disabled')
    .map((server) => `${server.name} (${server.state.status})`)
    .join(', ')
}

export class McpDeclarations {
  private turnCatalog: readonly McpCatalogEntry[] | undefined
  private turnThreshold = 0
  private readonly discovered: string[] = []
  /** The previous turn's catalogue definitions as JSON, so a real change is said once. */
  private catalogBytes: string | undefined
  private isDeferralSaid = false

  /**
  `source` is the pool (its sorted catalogue and server states now);
  `threshold` reads the person's defer threshold now. Both are read
  once per user turn, and before the first turn for any request made
  outside one.
  */
  public constructor(
    private readonly source: Pick<McpToolSource, 'catalog' | 'snapshot'>,
    private readonly threshold: () => number,
  ) {}

  /** Freeze this user turn's catalogue and threshold. */
  public beginTurn(): McpTurnStart {
    const catalog = this.source.catalog()
    this.turnCatalog = catalog
    this.turnThreshold = deferThreshold(this.threshold())
    const definitions = catalog.map((entry) => entry.definition)
    const bytes = JSON.stringify(definitions)
    const isChanged = this.catalogBytes !== undefined && bytes !== this.catalogBytes
    this.catalogBytes = bytes
    if (isChanged) {
      this.isDeferralSaid = false
    }
    const plan = this.plan()
    const isNewDeferral = plan.isDeferred && !this.isDeferralSaid
    this.isDeferralSaid ||= plan.isDeferred
    const changed = isChanged
      ? { toolCount: catalog.length, definitionTokens: estimateDefinitionTokens(definitions) }
      : undefined
    const log = [
      ...(changed === undefined
        ? []
        : [
            `MCP tool catalogue changed for the next request prefix: ${String(changed.toolCount)} tools, about ${String(changed.definitionTokens)} definition tokens`,
          ]),
      ...(isNewDeferral
        ? [
            `MCP tools deferred: ${String(plan.deferredCount)} of ${String(catalog.length)} tools load through tool_search (about ${String(plan.definitionTokens)} definition tokens over the person's ${String(this.turnThreshold)}-token threshold; set museSpark.modelApiMcpDeferTokens to 0 to always load them)`,
          ]
        : []),
    ]
    return {
      changed,
      deferral: isNewDeferral ? plan : undefined,
      log,
      notice: isNewDeferral
        ? fill(UI_TEXT.mcpToolsDeferred, {
            deferred: formatNumber(plan.deferredCount),
            total: formatNumber(catalog.length),
            tokens: formatNumber(plan.definitionTokens),
          })
        : undefined,
    }
  }

  /** The catalogue requests declare from: the turn's frozen one, else the pool's now. */
  public current(): readonly McpCatalogEntry[] {
    return this.turnCatalog ?? this.source.catalog()
  }

  /** The deferral plan for a request now. */
  public plan(): DeferralPlan {
    return planDeferral(
      this.current(),
      this.turnCatalog === undefined ? deferThreshold(this.threshold()) : this.turnThreshold,
      this.discovered,
    )
  }

  /**
  The MCP definitions a request declares. Deferred: `tool_search`
  first, then the discovered tools in discovery order (append-only,
  so the prefix only grows). Not deferred: the whole sorted
  catalogue. `isSearchAllowed` false (an allowlist without
  `tool_search`) declares the whole catalogue: deferral never makes an
  allowed tool unreachable.
  */
  public definitions(isSearchAllowed: boolean): readonly FunctionToolDefinition[] {
    const plan = this.plan()
    return isSearchAllowed && plan.isDeferred
      ? [toolSearchDefinition(this.current()), ...plan.declared.map((entry) => entry.definition)]
      : this.current().map((entry) => entry.definition)
  }

  /**
  Search the catalogue and load every match for the session (it runs
  nothing). A search that finds nothing names the servers not
  connected now (RSCH-CC R1), so a tool missing with its server is
  said, never silently absent.
  */
  public search(query: string): McpSearchAnswer {
    if (!this.plan().isDeferred) {
      return { kind: 'notDeferred' }
    }
    const matches = searchCatalog(this.current(), query)
    const loaded = matches.filter((entry) => !this.discovered.includes(entry.functionName))
    this.discovered.push(...loaded.map((entry) => entry.functionName))
    if (matches.length === 0) {
      const away = unconnectedMcpServers(this.source.snapshot())
      const none = fill(MODEL_API_MODEL_TEXT.toolSearchNone, { query })
      return {
        kind: 'searched',
        matches,
        loaded,
        output:
          away === ''
            ? none
            : `${none} ${fill(MODEL_API_MODEL_TEXT.toolSearchServersAway, { servers: away })}`,
        visibleOutput: UI_TEXT.toolSearchLoadedNone,
        log: 'tool_search matched no deferred MCP tool',
      }
    }
    const lines = matches.map(
      (entry) =>
        `- ${entry.functionName} (${entry.server}): ${entry.description} Arguments: ${entry.argumentNames.length === 0 ? '(none)' : entry.argumentNames.join(', ')}`,
    )
    const names = matches.map((entry) => entry.functionName).join(', ')
    return {
      kind: 'searched',
      matches,
      loaded,
      output: `${fill(MODEL_API_MODEL_TEXT.toolSearchFound, { count: String(matches.length) })}\n${lines.join('\n')}`,
      visibleOutput:
        loaded.length === 0
          ? fill(UI_TEXT.toolSearchAlreadyLoaded, { names })
          : fill(UI_TEXT.toolSearchLoaded, { count: formatNumber(loaded.length), names }),
      log: `tool_search matched ${String(matches.length)} MCP tool(s): ${String(loaded.length)} newly loaded, ${String(matches.length - loaded.length)} already loaded`,
    }
  }

  /** True for a catalogue tool a deferred request does not declare yet: it is not callable. */
  public isUndiscovered(functionName: string, isSearchAllowed: boolean): boolean {
    return (
      isSearchAllowed &&
      !this.discovered.includes(functionName) &&
      this.current().some((entry) => entry.functionName === functionName) &&
      this.plan().isDeferred
    )
  }

  /** True when this turn's catalogue or a discovery declared `functionName`. */
  public wasDeclared(functionName: string): boolean {
    return (
      this.discovered.includes(functionName) ||
      this.current().some((entry) => entry.functionName === functionName)
    )
  }
}
