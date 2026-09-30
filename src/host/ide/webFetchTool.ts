// Web fetch for Muse Code through the `ide` session server (M69, PLAN.md
// D49): Muse Code's own `web_fetch` is switched off in `muse serve`, so the
// extension fetches the page itself (webFetcher.ts) and hands its text back.
// The server is one loopback endpoint for the whole window, with no session
// identity, and it is attached even in Restricted Mode, so the tool:
//
// - is listed only while the workspace is trusted and
//   `museSpark.sandboxNetwork` does not deny the agent the network (the list
//   is read on every request, so a call made after either changes finds no
//   such tool);
// - declares itself open-world and not read-only (MCP annotations), so Muse
//   Code's own approval treats it as more than a read;
// - asks in the extension's own modal before every call, naming the host
//   and the URL, whatever mode Muse Code runs in, as the image tools do, and
//   checks that it is still offered after the answer, before each request
//   the fetch sends, and once the page is in;
// - stops when Muse Code stops waiting (a stopped turn closes the request
//   and sends `notifications/cancelled`, captured from Muse Code 1.4.0): an
//   answer given after that fetches nothing, and a fetch under way ends.
//
// Nothing is billed: the fetch is the extension's, not Meta's paid search.

import * as z from 'zod/mini'
import type { McpTool } from '../../core/mcp'
import { WEB_FETCH_DESCRIPTION, WEB_FETCH_PARAMETERS } from '../../core/web/webFetchDefinition'
import type { WebFetcher } from '../../core/web/webFetch'
import { approvalHost, checkPageUrl } from '../../core/web/pageUrl'
import {
  IDE_WEB_FETCH_TOOL,
  MCP_ANNOTATIONS_OPEN_WORLD,
  MODEL_TEXT,
  SANDBOX_NETWORK_DENIED,
  type SandboxNetworkMode,
} from '../../shared/constants'
import type { Logger } from '../logger'

export interface IdeWebFetchDeps {
  /** A trusted workspace whose sandbox network setting allows the network. */
  readonly isOffered: () => boolean
  readonly fetchPage: WebFetcher
  /** The modal before every fetch: true only when the user allowed this one. */
  readonly confirm: (url: string, host: string) => Promise<boolean>
  readonly log: Logger
}

const argsSchema = z.object({ url: z.string() })

/** A listener with nothing to do until it is replaced. */
function noop(): void {
  // Replaced before it can run; see unlessCancelled.
}

/**
 * Whether Muse Code is offered the fetch: a trusted workspace, and
 * `museSpark.sandboxNetwork` not set to deny its commands the network.
 */
export function isIdeWebFetchOffered(
  isTrusted: boolean,
  sandboxNetwork: SandboxNetworkMode,
): boolean {
  return isTrusted && sandboxNetwork !== SANDBOX_NETWORK_DENIED
}

/**
 * The modal, asked once per URL at a time: VS Code cannot close a modal a
 * caller stopped waiting for, so a retry of the same URL while it is still
 * open waits for that same answer instead of queueing a second modal.
 */
export function oneQuestionPerUrl(
  isAllowedByUser: (url: string, host: string) => Promise<boolean>,
): (url: string, host: string) => Promise<boolean> {
  const open = new Map<string, Promise<boolean>>()
  const isAllowedOnce = async (url: string, host: string): Promise<boolean> => {
    try {
      return await isAllowedByUser(url, host)
    } finally {
      open.delete(url)
    }
  }
  return async (url, host) => {
    const pending = open.get(url)
    if (pending !== undefined) {
      return await pending
    }
    const asked = isAllowedOnce(url, host)
    open.set(url, asked)
    return await asked
  }
}

/**
 * `start()`'s answer, or a refusal as soon as the caller stops waiting; a
 * caller that already stopped starts nothing (no modal for nobody).
 */
async function unlessCancelled<T>(start: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    throw new Error(MODEL_TEXT.webFetchCancelled)
  }
  let onAbort: () => void = noop
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => {
      reject(new Error(MODEL_TEXT.webFetchCancelled))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([start(), cancelled])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

async function callWebFetch(
  args: Readonly<Record<string, unknown>>,
  signal: AbortSignal,
  deps: IdeWebFetchDeps,
): Promise<string> {
  const parsed = argsSchema.safeParse(args)
  if (!parsed.success) {
    throw new Error(`invalid arguments: ${z.prettifyError(parsed.error)}`)
  }
  // A URL that would be refused anyway is refused before the modal.
  const checked = checkPageUrl(parsed.data.url)
  if (!checked.ok) {
    throw new Error(checked.failure.reason)
  }
  const host = approvalHost(checked.url)
  // Muse Code may stop waiting while the modal is open (Stop, its own time
  // limit, a restart): its answer then fetches nothing.
  const isAllowed = await unlessCancelled(
    async () => await deps.confirm(checked.url.href, host),
    signal,
  )
  if (!isAllowed) {
    deps.log.info(`Web fetch from ${host} declined in the extension's confirmation`)
    throw new Error(MODEL_TEXT.webFetchDeclined)
  }
  // Trust or the sandbox network may have changed while the modal was open.
  if (!deps.isOffered()) {
    throw new Error(MODEL_TEXT.webFetchNotOffered)
  }
  // Muse Code's stop reaches the fetch too; the fetch's own deadline bounds
  // it. The offer is asked again before each request goes out, and once the
  // page is in: it reaches the model only while web fetch is still offered.
  const result = await deps.fetchPage(checked.url.href, signal, deps.isOffered)
  if (signal.aborted) {
    throw new Error(MODEL_TEXT.webFetchCancelled)
  }
  if (!deps.isOffered()) {
    throw new Error(MODEL_TEXT.webFetchNotOffered)
  }
  if (result.kind === 'failed') {
    throw new Error(result.failure.reason)
  }
  return result.text
}

/** The tool as it stands now: none while the workspace is untrusted or the network is denied. */
export function ideWebFetchTools(deps: IdeWebFetchDeps): readonly McpTool[] {
  if (!deps.isOffered()) {
    return []
  }
  return [
    {
      name: IDE_WEB_FETCH_TOOL,
      description: WEB_FETCH_DESCRIPTION,
      inputSchema: {
        type: 'object',
        properties: WEB_FETCH_PARAMETERS,
        required: ['url'],
        additionalProperties: false,
      },
      annotations: MCP_ANNOTATIONS_OPEN_WORLD,
      call: async (args, signal) => await callWebFetch(args, signal, deps),
    },
  ]
}
