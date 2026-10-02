// The browser check for Muse Code through the `ide` session server (M81,
// PLAN.md D49). The server is one loopback endpoint for the whole window,
// with no session identity, attached even in Restricted Mode, so the tool,
// as web fetch (M69):
//
// - is listed only while the workspace is trusted and
//   `museSpark.sandboxNetwork` does not deny the agent the network;
// - declares itself open-world and not read-only (MCP annotations);
// - asks in the extension's own modal before every call, whatever mode Muse
//   Code runs in, naming the URL, and saying so when its host is beyond
//   loopback and the user's setting: allowing then widens this one check to
//   that host, and the model can widen nothing itself; a modal still open
//   is shared only with a call of the same URL, widening and hosts, and the
//   setting is read again after the answer (a call whose hosts changed
//   meanwhile opens nothing);
// - stops when Muse Code stops waiting, the browser killed with it.
//
// It answers text only, the console errors and the failed requests, until a
// live capture shows an `ide` tool's image content reaches the Muse Code
// model (AGENTS.md rule 13). Nothing is billed.

import { randomBytes } from 'node:crypto'
import type { McpTool } from '../../core/mcp'
import {
  BROWSER_CHECK_PARAMETERS,
  BROWSER_CHECK_REQUIRED,
  type BrowserCheckScope,
  browserCheckScope,
  browserRefusal,
  browserReportText,
  browserScopeKey,
  extraHostSet,
  IDE_BROWSER_CHECK_DESCRIPTION,
  placeBrowserCall,
} from '../../core/browser/browserTool'
import type { BrowserChecker } from '../../core/browser/browserRun'
import {
  BROWSER_CHECK_MARKER_BYTES,
  IDE_BROWSER_CHECK_TOOL,
  MCP_ANNOTATIONS_OPEN_WORLD,
  MODEL_TEXT,
} from '../../shared/constants'
import type { Logger } from '../logger'
import { unlessCancelled } from './webFetchTool'

export interface IdeBrowserCheckDeps {
  /** A trusted workspace whose sandbox network setting allows the network. */
  readonly isOffered: () => boolean
  /** `museSpark.browserCheckExtraHosts`, read at each use. */
  readonly extraHosts: () => readonly string[]
  /**
   * The modal before every check: true only when the user allowed this one.
   * `scope.widenedHost` is the URL's host when it is beyond loopback and the
   * setting; a modal already open is shared only by a call of the same URL
   * and scope (`browserScopeKey`).
   */
  readonly confirm: (url: string, scope: BrowserCheckScope) => Promise<boolean>
  readonly check: BrowserChecker
  readonly log: Logger
}

/** The call placed against the setting as it stands now: its URL and scope as one key. */
function placedKey(
  args: Readonly<Record<string, unknown>>,
  extraHosts: readonly string[],
): string | undefined {
  const placed = placeBrowserCall(args, extraHostSet(extraHosts))
  return placed.ok
    ? browserScopeKey(placed.placement.url, browserCheckScope(placed.placement, extraHosts))
    : undefined
}

async function callBrowserCheck(
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  deps: IdeBrowserCheckDeps,
): Promise<string> {
  // A call that would be refused anyway is refused before the modal.
  const extraHosts = deps.extraHosts()
  const placed = placeBrowserCall(args, extraHostSet(extraHosts))
  if (!placed.ok) {
    throw new Error(placed.model)
  }
  const { placement, actions } = placed
  const scope = browserCheckScope(placement, extraHosts)
  const isAllowed = await unlessCancelled(
    async () => await deps.confirm(placement.url, scope),
    signal,
    MODEL_TEXT.browserCheckCancelled,
  )
  if (!isAllowed) {
    deps.log.info("Browser check declined in the extension's confirmation")
    throw new Error(MODEL_TEXT.browserCheckDeclined)
  }
  // Trust or the sandbox network may have changed while the modal was open.
  if (!deps.isOffered()) {
    throw new Error(MODEL_TEXT.browserCheckNotOffered)
  }
  // So may the setting: the answer covers only the scope the modal showed.
  if (placedKey(args, deps.extraHosts()) !== browserScopeKey(placement.url, scope)) {
    throw new Error(MODEL_TEXT.browserCheckScopeChanged)
  }
  const result = await deps.check({
    url: placement.url,
    actions,
    allowedHosts: scope.allowedHosts,
    includeScreenshot: false,
    signal,
  })
  if (!result.ok) {
    throw new Error(browserRefusal(result.failure).model)
  }
  // What the page produced reaches the model only while the check is still offered.
  if (!deps.isOffered()) {
    throw new Error(MODEL_TEXT.browserCheckNotOffered)
  }
  return browserReportText(
    placement.url,
    result.report,
    randomBytes(BROWSER_CHECK_MARKER_BYTES).toString('hex'),
  )
}

/** The tool as it stands now: none while the workspace is untrusted or the network is denied. */
export function ideBrowserCheckTools(deps: IdeBrowserCheckDeps): readonly McpTool[] {
  if (!deps.isOffered()) {
    return []
  }
  return [
    {
      name: IDE_BROWSER_CHECK_TOOL,
      description: IDE_BROWSER_CHECK_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: BROWSER_CHECK_PARAMETERS,
        required: [...BROWSER_CHECK_REQUIRED],
        additionalProperties: false,
      },
      annotations: MCP_ANNOTATIONS_OPEN_WORLD,
      call: async (args, signal) => await callBrowserCheck(args, signal, deps),
    },
  ]
}
