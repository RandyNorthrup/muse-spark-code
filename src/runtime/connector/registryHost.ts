// M124 (D106, D217): one connection's registries and their one approval
// page. Stdio creates a single registry; the HTTPS transport creates one
// per session, each under its own (possibly scope-narrowed) authority.
// The approval page is shared: it shows every live registry's pending
// intents and routes a decision to the registry that owns the intent.
// Nothing here weakens the single-registry behaviour: the same page
// lifecycle (none → starting → open → closed) decides when a browser
// opens and when a failed page retires.
import { userInfo } from 'node:os'
import { CONNECTOR_SERVER_NAME } from '../../shared/constants'
import type { SavedPrompt } from '../../shared/prompts'
import type { ShareRequest } from '../../shared/share'
import { ConnectorAudit } from '../../core/connector/audit'
import { createConnectorScrub } from '../../core/connector/redaction'
import {
  ConnectorRegistry,
  type AuthorityPort,
  type ReportsPort,
} from '../../core/connector/registry'
import type { SchedulesPort } from '../../core/connector/tools/schedules'
import { PromptStore } from '../../core/prompts/promptStore'
import { buildPromptShare } from '../../core/sharing/promptShare'
import { createChatSharePrivacy } from '../../core/sharing/privacy'
import { runtimeSharingConfidential } from '../sharing/confidential'
import { startApprovalPage, type ApprovalPage } from './approvalPage'
import type { ConnectorStore } from './store'

export interface ConnectorRegistryHostDeps {
  readonly connectionId: string
  readonly dataFolder: string
  readonly homeDir: string
  readonly version: string
  readonly registered: () => readonly string[]
  readonly openBrowser: (url: string) => Promise<void>
  readonly schedules: SchedulesPort
  readonly reports: ReportsPort
  readonly store: ConnectorStore
}

/** The registry host for one connection, from the runtime's own dependencies. */
export function registryHostFor(
  deps: Omit<ConnectorRegistryHostDeps, 'connectionId' | 'store'>,
  connectionId: string,
  store: ConnectorStore,
): ConnectorRegistryHost {
  return new ConnectorRegistryHost({
    connectionId,
    dataFolder: deps.dataFolder,
    homeDir: deps.homeDir,
    version: deps.version,
    registered: deps.registered,
    openBrowser: deps.openBrowser,
    schedules: deps.schedules,
    reports: deps.reports,
    store,
  })
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

export class ConnectorRegistryHost {
  private readonly registries = new Set<ConnectorRegistry>()
  private lifecycle: PageLifecycle = { kind: 'none', page: undefined }
  private isClosing = false
  private readonly audit: ConnectorAudit
  private readonly privacy: ReturnType<typeof createChatSharePrivacy>
  private readonly scrub: ReturnType<typeof createConnectorScrub>

  public constructor(private readonly deps: ConnectorRegistryHostDeps) {
    this.privacy = createChatSharePrivacy({
      // No workspace root is folded to a relative path: every absolute path is scrubbed.
      workspaceRoots: [],
      home: deps.homeDir,
      userName: userInfo().username,
      redactRegisteredSecrets: (text) => text,
    })
    this.scrub = createConnectorScrub(this.privacy, deps.registered)
    this.audit = new ConnectorAudit(
      deps.store.audit(deps.connectionId, Date.now),
      deps.connectionId,
      Date.now,
      this.scrub.text,
    )
  }

  private isAvailable(page: ApprovalPage): boolean {
    return !this.isClosing && this.lifecycle.page === page
  }

  private async showPage(): Promise<boolean> {
    if (this.isClosing) return false
    if (this.lifecycle.page === undefined) {
      this.lifecycle = {
        kind: 'starting',
        page: (async () => {
          const page = await startApprovalPage({
            pending: () => [...this.registries].flatMap((registry) => registry.pending()),
            decide: (intentId, digest, isApproved) =>
              [...this.registries].some((registry) =>
                registry.decide(intentId, digest, isApproved),
              ),
          })
          this.lifecycle = { kind: 'open', page }
          void page.closed.then(() => {
            // Only this page can retire its ownership, never a replacement.
            if (this.lifecycle.page === page) this.lifecycle = { kind: 'closed', page: undefined }
          })
          return page
        })(),
      }
    }
    const active = this.lifecycle
    try {
      const page = await active.page
      // A page that finished starting after the client left opens nothing.
      if (!this.isAvailable(page)) return false
      if (!page.isWatched()) await this.deps.openBrowser(page.launchUrl())
      return this.isAvailable(page)
    } catch {
      // Opener and EPANEL_CLOSED failures retire the page before a retry.
      await closePage(active.page)
      if (this.lifecycle === active) this.lifecycle = { kind: 'closed', page: undefined }
      return false
    }
  }

  /** A registry for one client connection, tracked until `release`. */
  public create(authority: AuthorityPort): ConnectorRegistry {
    const deps = this.deps
    const storeFor = (root: string | undefined) => new PromptStore(deps.dataFolder, root)
    const registry = new ConnectorRegistry(
      {
        connectionId: deps.connectionId,
        version: deps.version,
        now: Date.now,
        authority,
        confidential: runtimeSharingConfidential,
        audit: this.audit,
        scrub: this.scrub,
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
            return buildPromptShare(prompt, request, new Date().toISOString(), this.privacy).content
          },
        },
        surface: {
          changed: () => {
            if (this.lifecycle.kind === 'open') this.lifecycle.page.changed()
          },
          show: async () => await this.showPage(),
        },
      },
      CONNECTOR_SERVER_NAME,
    )
    this.registries.add(registry)
    return registry
  }

  /** Stops tracking a registry whose transport already disconnected it. */
  public async release(registry: ConnectorRegistry): Promise<void> {
    await registry.drained()
    this.registries.delete(registry)
  }

  /** Drains every registry and closes the page; no page opens afterwards. */
  public async close(): Promise<void> {
    this.isClosing = true
    await Promise.all(
      [...this.registries].map(async (registry) => {
        await registry.drained()
      }),
    )
    this.registries.clear()
    await closePage(this.lifecycle.page)
  }
}

/**
An authority narrowed to an OAuth token's scopes (D217): the live grant
with its scope list cut to the token's, refreshing and watching exactly
as the store's authority does. Revocation and the kill switch pass
through unchanged.
*/
export function scopedAuthority(
  base: AuthorityPort,
  scopes: readonly string[] | (() => readonly string[]),
): AuthorityPort {
  const allowed = (): readonly string[] => (typeof scopes === 'function' ? scopes() : scopes)
  return {
    current: () => {
      const state = base.current()
      if (state.grant === undefined) return state
      const current = allowed()
      return {
        killed: state.killed,
        grant: {
          ...state.grant,
          scopes: state.grant.scopes.filter((scope) => current.includes(scope)),
        },
      }
    },
    refresh: async () => {
      await base.refresh()
    },
    watch: (changed) => base.watch(changed),
  }
}

/**
One file watcher for every session: the store's authority starts a watcher
for each `watch` call, and the HTTPS endpoint creates a registry (which
watches) per session. The watcher lives while any session listens.
*/
export function sharedWatchAuthority(base: AuthorityPort): AuthorityPort {
  const listeners = new Set<() => void>()
  let stop: (() => void) | undefined
  return {
    current: () => base.current(),
    refresh: async () => {
      await base.refresh()
    },
    watch: (changed) => {
      listeners.add(changed)
      stop ??= base.watch(() => {
        for (const listener of listeners) listener()
      })
      return () => {
        listeners.delete(changed)
        if (listeners.size > 0) {
          return
        }

        stop?.()
        stop = undefined
      }
    },
  }
}
