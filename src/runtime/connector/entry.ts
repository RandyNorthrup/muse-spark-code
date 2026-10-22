// M124 (D106): dist/connector.js, loaded only by `muse-spark-code-acp mcp`.
// ACP stays its own protocol mode; this entry serves MCP over stdio. No
// login, model call, key access or effect happens because a client
// initializes or lists tools. The runtime took its credential variables out
// of its environment before this loads; nothing here starts a child process
// except the fixed browser opener for our approval page and the storage
// guard's fixed OS scripts, which run only at startup and when the store
// creates a file, never for a call.
import { userInfo } from 'node:os'
import { createInterface } from 'node:readline/promises'
import type { Readable, Writable } from 'node:stream'
import path from 'node:path'
import { CONNECTOR_FOLDER, CONNECTOR_SERVER_NAME } from '../../shared/constants'
import type { UiText } from '../../shared/l10n/en'
import { fill, setUiText } from '../../shared/l10n/text'
import type { SavedPrompt } from '../../shared/prompts'
import type { ShareRequest } from '../../shared/share'
import { ConnectorAudit } from '../../core/connector/audit'
import { ConnectorProtocol } from '../../core/connector/protocol'
import { createConnectorScrub } from '../../core/connector/redaction'
import { ConnectorRegistry, type ReportsPort } from '../../core/connector/registry'
import type { SchedulesPort } from '../../core/connector/tools/schedules'
import { PromptStore } from '../../core/prompts/promptStore'
import { buildPromptShare } from '../../core/sharing/promptShare'
import { createChatSharePrivacy } from '../../core/sharing/privacy'
import { runtimeSharingConfidential } from '../sharing/confidential'
import { startApprovalPage, type ApprovalPage } from './approvalPage'
import { parseConnectorCommand, runConnectorCommand } from './command'
import { serveStdio } from './stdio'
import { ConnectorStore } from './store'
import { isStorageRefused, type ConnectorStorageGuard } from './storageGuardPort'

export interface ConnectorRuntimeDeps {
  readonly argv: readonly string[]
  readonly table: UiText
  readonly locale: string
  readonly dataFolder: string
  readonly homeDir: string
  readonly version: string
  readonly stdin: Readable
  readonly stdout: Writable
  readonly stderr: Writable
  readonly isInteractive: boolean
  /** Credential values the runtime took from its environment, for redaction only. */
  readonly registered: () => readonly string[]
  /** The fixed OS opener, given only our checked loopback URL. */
  readonly openBrowser: (url: string) => Promise<void>
  readonly schedules: SchedulesPort
  readonly reports: ReportsPort
  /** The storage guard (RVM124 finding 15), loaded with the `mcp` command. */
  readonly storageGuard: ConnectorStorageGuard
}

function line(stream: Writable, text: string): void {
  stream.write(`${text}\n`)
}

type PageLifecycle =
  | { readonly kind: 'none' | 'closed'; readonly page: undefined }
  | { readonly kind: 'starting'; readonly page: Promise<ApprovalPage> }
  | { readonly kind: 'open'; readonly page: ApprovalPage }

/** Closes an open or starting page; a page that failed to start has nothing to close. */
async function closePage(page: PageLifecycle['page']): Promise<void> {
  try {
    const started = await page
    await started?.close()
  } catch {
    // It never started: no listener is left.
  }
}

/** The process's exit code: 0 after a clean disconnect or a command that succeeded. */
export async function runConnector(deps: ConnectorRuntimeDeps): Promise<number> {
  setUiText(deps.table, deps.locale)
  const command = parseConnectorCommand(deps.argv)
  const store = new ConnectorStore(deps.dataFolder, deps.storageGuard)
  if (command === undefined) {
    line(deps.stderr, deps.table.acpConnector.usage)
    return 2
  }
  if (['serve', 'grant', 'resume', 'status'].includes(command.kind)) {
    try {
      await deps.storageGuard.verify()
      // Serving writes receipts from the first frame: their storage is
      // created and secured now, never inside a receipt's timeout.
      if (command.kind === 'serve') await store.prepareAudit(command.connectionId)
    } catch (error: unknown) {
      if (!isStorageRefused(error)) throw error
      line(
        deps.stderr,
        fill(deps.table.acpConnector.storageRefused, {
          folder: path.join(deps.dataFolder, CONNECTOR_FOLDER),
        }),
      )
      return 1
    }
  }
  if (command.kind !== 'serve')
    return await runConnectorCommand(store, command, {
      isInteractive: deps.isInteractive,
      now: Date.now,
      print: (text) => {
        line(deps.stdout, text)
      },
      printError: (text) => {
        line(deps.stderr, text)
      },
      confirm: async (question) => {
        const input = createInterface({ input: deps.stdin, output: deps.stderr })
        try {
          const answer = await input.question(`${question} `)
          return answer.trim().toLowerCase() === 'y'
        } catch {
          // Ctrl+C or Ctrl+D at the prompt is a no, never a crash.
          return false
        } finally {
          input.close()
        }
      },
    })
  const privacy = createChatSharePrivacy({
    // No workspace root is folded to a relative path: every absolute path is scrubbed.
    workspaceRoots: [],
    home: deps.homeDir,
    userName: userInfo().username,
    redactRegisteredSecrets: (text) => text,
  })
  const scrub = createConnectorScrub(privacy, deps.registered)
  const audit = new ConnectorAudit(
    store.audit(command.connectionId, Date.now),
    command.connectionId,
    Date.now,
    scrub.text,
  )
  const storeFor = (root: string | undefined) => new PromptStore(deps.dataFolder, root)
  let lifecycle: PageLifecycle = { kind: 'none', page: undefined }
  let isClosing = false
  const isAvailable = (page: ApprovalPage) => !isClosing && lifecycle.page === page
  const registry: ConnectorRegistry = new ConnectorRegistry(
    {
      connectionId: command.connectionId,
      version: deps.version,
      now: Date.now,
      authority: store.authority(command.connectionId),
      confidential: runtimeSharingConfidential,
      audit,
      scrub,
      schedules: deps.schedules,
      reports: deps.reports,
      prompts: {
        list: (root, scope) => storeFor(root).list(scope),
        write: (root, prompt: SavedPrompt, expectedGeneration?: number) =>
          storeFor(root).write(prompt, false, expectedGeneration),
        preview: (_root, prompt, format) => {
          const request: ShareRequest = {
            target: 'prompt',
            mode: 'conversation',
            format,
            destination: 'copy',
            options: {
              codeBlocks: true,
              attachmentNames: true,
              diffs: false,
              attachmentContents: [],
            },
            source: { kind: 'saved', promptId: prompt.id, scope: prompt.scope },
          }
          return buildPromptShare(prompt, request, new Date().toISOString(), privacy).content
        },
      },
      surface: {
        changed: () => {
          if (lifecycle.kind === 'open') lifecycle.page.changed()
        },
        show: async () => {
          if (isClosing) return false
          if (lifecycle.page === undefined)
            lifecycle = {
              kind: 'starting',
              page: (async () => {
                const page = await startApprovalPage({
                  pending: () => registry.pending(),
                  decide: (intentId, digest, isApproved) =>
                    registry.decide(intentId, digest, isApproved),
                })
                lifecycle = { kind: 'open', page }
                void page.closed.then(() => {
                  // Only this page can retire its ownership, never a replacement.
                  if (lifecycle.page === page) lifecycle = { kind: 'closed', page: undefined }
                })
                return page
              })(),
            }
          const active = lifecycle
          try {
            const page = await active.page
            // A page that finished starting after the client left opens nothing.
            if (!isAvailable(page)) return false
            if (!page.isWatched()) await deps.openBrowser(page.launchUrl())
            return isAvailable(page)
          } catch {
            // Opener and EPANEL_CLOSED failures retire the page before a retry.
            await closePage(active.page)
            if (lifecycle === active) lifecycle = { kind: 'closed', page: undefined }
            return false
          }
        },
      },
    },
    CONNECTOR_SERVER_NAME,
  )
  try {
    await serveStdio({ input: deps.stdin, output: deps.stdout }, new ConnectorProtocol(registry))
    return 0
  } finally {
    // The transport has disconnected the registry (its own finally): every
    // call is stopped. Done only once pending work and the page's own
    // start-up have settled.
    isClosing = true
    await registry.drained()
    await closePage(lifecycle.page)
  }
}
