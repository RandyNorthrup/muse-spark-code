// Fast (the plan's priority tier) must never be sent while the panel shows
// it off. The real ConversationController drives the real ModelApiHost, the
// real subscription client and the real Responses codec; only the outside
// world is replaced: the two provider endpoints (a catalogue answer and a
// streamed reply, as data) and the editor-side ports the panel is built on
// (they are never reached here and refuse if they were). No sign-in, token or
// model call: the grant is a throwaway record in memory.
import { randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as z from 'zod/mini'
import { ModelApiClient } from '../../src/core/backends/modelapi/client'
import { ModelApiHost } from '../../src/core/backends/modelapi/ModelApiHost'
import { BestOfNCoordinator } from '../../src/core/bestOfN/bestOfNCoordinator'
import { PlanModeHold } from '../../src/core/review/planModeHold'
import { reviewTurnText } from '../../src/core/review/reviewPrompt'
import { GitHubClient } from '../../src/core/git/github'
import { providerEntrySchema, type ProvidersFile } from '../../src/core/providers/providersFile'
import { PendingPrompts } from '../../src/core/sessionBoard'
import { ChatGptSignIn, type ChatGptHostPort } from '../../src/core/providers/subscriptions/chatgpt'
import { createSubscriptionClient } from '../../src/core/providers/subscriptions/registry'
import type { AuthSnapshot } from '../../src/host/auth/authService'
import { fileContextIo } from '../../src/host/backend/contextIo'
import { createToolIo } from '../../src/host/backend/toolIo'
import { canonicalPath } from '../../src/host/canonicalPath'
import { createCheckpointPort } from '../../src/host/checkpoints/checkpointHost'
import { ConversationController } from '../../src/host/conversation/conversationController'
import { ConversationGit, type GitWindow } from '../../src/host/git/conversationGit'
import { processGitRunner } from '../../src/host/git'
import { PullRequestLinks } from '../../src/host/git/pullRequestLinks'
import { reviewMarker } from '../../src/host/review/reviewCollector'
import type { HostToWebviewMessage } from '../../src/shared/protocol'
import { MODEL_API_BASE_URL } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'

const FAST_MODEL = 'chatgpt/gpt-6.1-sol'
const PLAIN_MODEL = 'chatgpt/gpt-6.1-luna'

/** The captured catalogue entry (2026-10-14): its `service_tiers` offers Fast. */
const fastEntry = z
  .record(z.string(), z.unknown())
  .parse(
    JSON.parse(
      readFileSync(
        new URL('../fixtures/chatgpt-catalogue/gpt-6.1-sol.json', import.meta.url),
        'utf8',
      ),
    ),
  )
const workspace = mkdtempSync(path.join(tmpdir(), 'fast-tier-'))
afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

function unreached(): Promise<never> {
  return Promise.reject(new Error('not reached by this case'))
}

function frame(event: unknown): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

function requestUrl(input: string | URL | Request): URL {
  if (typeof input === 'string') return new URL(input)
  return input instanceof URL ? input : new URL(input.url)
}

/**
 * The provider: the plan's catalogue (the captured entry, and the same entry
 * without a Fast tier for the second model) and a streamed text reply. Every
 * request body of `POST /v1/responses` is kept, parsed.
 */
function providerFetch(): { readonly fetch: typeof fetch; readonly bodies: unknown[] } {
  const bodies: unknown[] = []
  const impl = (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input)
    if (url.origin !== 'https://api.openai.com') return Promise.reject(new Error('foreign request'))
    if (url.pathname === '/v1/models') {
      const plain = { ...fastEntry, slug: 'gpt-6.1-luna', service_tiers: [] }
      return Promise.resolve(Response.json({ models: [fastEntry, plain] }))
    }
    if (url.pathname !== '/v1/responses' || typeof init?.body !== 'string') {
      return Promise.reject(new Error('unexpected request'))
    }
    bodies.push(JSON.parse(init.body))
    const message = {
      type: 'message',
      id: `msg_${String(bodies.length)}`,
      role: 'assistant',
      content: [{ type: 'output_text', text: 'ok' }],
      status: 'completed',
    }
    const text =
      frame({ type: 'response.output_item.done', output_index: 0, item: message }) +
      frame({
        type: 'response.completed',
        response: {
          id: `resp_${String(bodies.length)}`,
          status: 'completed',
          output: [message],
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      })
    return Promise.resolve(new Response(text, { status: 200 }))
  }
  return { fetch: impl, bodies }
}

/** A throwaway plan grant held in memory, never a stored or live one. */
function throwawayGrant(): ChatGptHostPort {
  const record = {
    v: 1 as const,
    auth: 'subscription' as const,
    origin: 'https://api.openai.com' as const,
    issuer: 'https://auth.openai.com' as const,
    clientId: 'throwaway-client',
    hostId: 'throwaway-host',
    accessToken: 'throwaway-access',
    refreshToken: 'throwaway-refresh',
    expiresAt: Date.now() + 3_600_000,
    scope: 'openid profile email offline_access resource.invoke chatgpt.tokens.use.direct',
    nonce: 'throwaway-nonce',
  }
  return {
    hostId: 'throwaway-host',
    fetch: () => Promise.reject(new Error('the grant never refreshes here')),
    now: Date.now,
    openBrowser: unreached,
    startCallback: unreached,
    readRecord: () => Promise.resolve(record),
    writeRecord: () => Promise.resolve(),
    deleteRecord: () => Promise.resolve(),
    withRefreshLock: (work) => work(),
  }
}

const silent = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

function panel() {
  const provider = providerFetch()
  const file: ProvidersFile = {
    v: 1,
    providers: [
      providerEntrySchema.parse({
        id: 'chatgpt',
        preset: 'chatgpt',
        address: 'https://api.openai.com',
        auth: 'subscription',
        format: 'responses',
        models: ['gpt-6.1-sol', 'gpt-6.1-luna'],
      }),
    ],
  }
  const meta = new ModelApiClient({
    baseUrl: MODEL_API_BASE_URL,
    apiKey: () => Promise.resolve(undefined),
    fetch: unreached,
    sleep: () => Promise.resolve(),
    now: Date.now,
    random: () => 0,
    log: silent,
  })
  const client = createSubscriptionClient(meta, {
    fetch: provider.fetch,
    providers: () => Promise.resolve(file),
    chatgpt: () => Promise.resolve(new ChatGptSignIn(throwawayGrant())),
    accountId: () => Promise.resolve('throwaway-account'),
  })
  const host = new ModelApiHost({
    client,
    // No Meta key: the models listed are the plan's, as on a plan-only computer.
    hasMetaCredential: () => false,
    workspaceRoot: workspace,
    platform: process.platform,
    io: createToolIo({
      platform: process.platform,
      listFiles: () => Promise.resolve([]),
      systemRoot: process.env['SystemRoot'],
      env: () => ({}),
      searchWorkerPath: path.join(workspace, 'no-search-worker.js'),
      log: () => undefined,
      unsavedFiles: () => [],
    }),
    contextIo: fileContextIo,
    newId: randomUUID,
    now: Date.now,
    log: silent,
    personalSkillsRoot: undefined,
    personalAgentsRoot: undefined,
    isWorkspaceTrusted: () => true,
    isConfidentialWorkspace: () => false,
    confirmContributorModel: () => Promise.resolve(false),
    getAccountId: () => client.currentKeyDigest(),
    describeEnvironment: () => Promise.resolve({ git: undefined }),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    promptCacheRetention: () => 'in_memory',
    sessionBudgetUsd: () => Usd.from(0).toAmount(),
    showReplyUsage: () => false,
    allowsPaidUse: () => Promise.resolve(false),
    isPaidUseRemembered: () => false,
    noteSubagentUsage: () => undefined,
    noteReviewerUsage: () => undefined,
    memory: undefined,
  })
  const posted: HostToWebviewMessage[] = []
  const surface = {
    id: 'fast-tier',
    documentId: 'doc',
    post: (message: HostToWebviewMessage) => {
      posted.push(message)
    },
    reveal: () => undefined,
    markUnread: () => undefined,
    setTitle: () => undefined,
    reload: () => undefined,
    takeRestoredSessionId: () => undefined,
    dispose: () => undefined,
  }
  const signedIn: AuthSnapshot = { status: 'signedIn', detail: undefined, backend: 'modelApi' }
  const gitWindow: GitWindow = {
    workspaceRoot: undefined,
    platform: process.platform,
    isWorkspaceTrusted: () => true,
    hold: () => undefined,
    worktree: () => undefined,
    repository: unreached,
    captureGitOwner: unreached,
    admit: () => unreached(),
    githubToken: () => Promise.resolve(undefined),
    github: new GitHubClient({ fetch: unreached, userAgent: 'fast-tier-test', log: silent }),
    links: new PullRequestLinks({ get: () => undefined, update: () => Promise.resolve() }),
    confirmPush: () => Promise.resolve(false),
    confirmCommit: () => Promise.resolve(false),
    untrackedFingerprint: unreached,
    untrackedDiff: unreached,
    pickRemote: () => Promise.resolve(undefined),
    confirmWorktreeTrust: unreached,
    now: Date.now,
    log: silent,
  }
  const controller = new ConversationController({
    checkpoints: createCheckpointPort({
      store: undefined,
      isNamespaceKnown: () => true,
      isWorkspaceTrusted: () => true,
      isEnabled: () => false,
      hasGit: () => false,
    }),
    unsavedPaths: () => [],
    confirmFileAction: () => Promise.resolve(false),
    surface,
    auth: {
      current: signedIn,
      backend: 'modelApi',
      admissionGeneration: 0,
      toMessage: () => ({ type: 'authState', status: 'signedIn' }),
      signIn: unreached,
      installMuseCode: unreached,
      cancelSignIn: () => undefined,
      signOut: unreached,
      refresh: () => Promise.resolve(signedIn),
      markAuthRequired: () => signedIn,
      markBackendError: () => signedIn,
      checkAgain: () => Promise.resolve(signedIn),
    },
    ensureHost: () => Promise.resolve(host),
    workspaceRoot: workspace,
    modelId: FAST_MODEL,
    initialPermissionMode: 'manual',
    hasApprovalUi: true,
    openExternal: () => undefined,
    mentions: { search: () => Promise.resolve([]), contains: () => Promise.resolve(false) },
    files: {
      showOpenDialog: () => Promise.resolve([]),
      readFile: unreached,
      canonicalRelativePath: () => Promise.resolve(undefined),
      pickMentionFile: () => Promise.resolve(undefined),
      toRelativePath: () => undefined,
    },
    isBypassAllowed: () => false,
    isRemoteWindow: false,
    confirmRemoteBypass: () => Promise.resolve(false),
    isConfidentialWorkspace: () => false,
    confirmContributor: () => Promise.resolve(false),
    runHostAction: () => Promise.resolve(),
    copyText: unreached,
    insertCode: unreached,
    onSandboxUnavailable: () => undefined,
    platform: process.platform,
    shellSandbox: () => ({ isSandboxed: false, reason: 'setting', isUnsupportedWorkspace: false }),
    editorContext: () => undefined,
    isAutosaveEnabled: () => false,
    saveAll: () => Promise.resolve(),
    unsavedFiles: () => [],
    applyCode: unreached,
    editReview: {
      openDiff: unreached,
      revert: unreached,
      describe: unreached,
      revertHunk: unreached,
    },
    review: {
      collect: unreached,
      turnText: reviewTurnText,
      newMarker: reviewMarker,
      createHold: (deps) => new PlanModeHold(deps),
    },
    openDocument: unreached,
    openFile: unreached,
    readToolImage: unreached,
    ideMcpEndpoint: () => Promise.resolve(undefined),
    newAttachmentId: () => randomUUID(),
    sessions: {
      archivedIds: () => [],
      setArchivedIds: () => Promise.resolve(),
      damagedIds: () => [],
      setDamagedIds: () => Promise.resolve(),
      lastSession: () => undefined,
      setLastSession: () => Promise.resolve(),
    },
    accountFacts: () => Promise.resolve({ signInMethod: 'apiKey' as const }),
    usageInsights: () => Promise.resolve(undefined),
    isRestorable: false,
    dictation: { isAvailable: false, reason: 'no microphone in this case' },
    museVoice: () => undefined,
    modelApiSessionBudgetUsd: () => Usd.from(0).toAmount(),
    voiceAccountId: () => Promise.resolve(undefined),
    ownedVoiceBudgetScope: () => Promise.resolve(undefined),
    notifyAttention: () => undefined,
    pendingPrompts: new PendingPrompts(),
    bestOfNCoordinator: new BestOfNCoordinator(),
    modelApiAccountId: () => Promise.resolve(undefined),
    openBestOfNWorktree: unreached,
    noteBestOfNRequest: () => undefined,
    noteBestOfNUsage: () => undefined,
    runGit: processGitRunner(),
    isPaidFeatureOn: () => false,
    notePaidUse: () => undefined,
    buildAttemptHost: unreached,
    realPath: canonicalPath,
    exports: {
      saveMarkdown: unreached,
      saveSessionLog: unreached,
      saveJson: unreached,
      previewExport: unreached,
      localRoots: () => [workspace],
    },
    transferFiles: { pickTransferFile: unreached, confirmImport: unreached },
    plans: undefined,
    setPaidFeature: unreached,
    isWorkspaceTrusted: () => true,
    isWorktreeHeld: () => false,
    createGit: (gitSurface) => new ConversationGit(gitWindow, gitSurface),
    onForegroundTasksChanged: () => undefined,
    allowsPaidUse: () => Promise.resolve(false),
    forgetPaidUse: unreached,
    now: Date.now,
    log: silent,
  })
  return { controller, host, posted, bodies: provider.bodies }
}

type Panel = ReturnType<typeof panel>

/** One message through the panel, then the provider's request it caused, once the turn ends. */
async function send(p: Panel, localId: string): Promise<Record<string, unknown>> {
  const before = p.bodies.length
  await p.controller.handle({ type: 'sendMessage', localId, text: 'hi', attachmentIds: [] })
  await vi.waitFor(() => {
    expect(p.bodies.length).toBe(before + 1)
    expect(
      p.posted.filter(
        (message) => message.type === 'agentEvent' && message.event.type === 'turnCompleted',
      ),
    ).toHaveLength(before + 1)
  })
  return p.bodies[before] as Record<string, unknown>
}

function shownFast(p: Panel): boolean | undefined {
  const state = p.posted.findLast((message) => message.type === 'composerState')
  return state?.type === 'composerState' ? state.isFastEnabled : undefined
}

/** The panel opening: its warm-up lists the models, which is when it learns each model's default. */
async function open(p: Panel): Promise<void> {
  p.controller.surfaceReady()
  await vi.waitFor(() => {
    expect(p.posted.some((message) => message.type === 'modelList')).toBe(true)
  })
}

/** The effort the panel last showed. */
function shownEffort(p: Panel): string | undefined {
  const state = p.posted.findLast((message) => message.type === 'composerState')
  return state?.type === 'composerState' ? state.effort : undefined
}

describe('a plan model starts on the catalogue default effort (R9)', () => {
  it('starts a fresh conversation on low, the captured default, not the standing high', async () => {
    const p = panel()
    // The panel lists the models when it opens, before any message.
    await open(p)
    expect(shownEffort(p)).toBe('low')
    const first = await send(p, 'l0')
    expect(first).toMatchObject({ reasoning: { effort: 'low' } })
    p.controller.dispose()
  })

  it('keeps a level the person chose, across a new conversation and a model switch', async () => {
    const p = panel()
    await open(p)
    await p.controller.handle({ type: 'setEffort', effort: 'xhigh' })
    expect(await send(p, 'l0')).toMatchObject({ reasoning: { effort: 'xhigh' } })
    await p.controller.handle({ type: 'clearConversation' })
    expect(await send(p, 'l1')).toMatchObject({ reasoning: { effort: 'xhigh' } })
    await p.controller.handle({ type: 'setModel', modelId: PLAIN_MODEL })
    expect(await send(p, 'l2')).toMatchObject({ reasoning: { effort: 'xhigh' } })
    expect(shownEffort(p)).toBe('xhigh')
    p.controller.dispose()
  })

  it('moves a model switch that nobody chose a level for to the new model default', async () => {
    const p = panel()
    await open(p)
    await send(p, 'l0')
    await p.controller.handle({ type: 'setModel', modelId: PLAIN_MODEL })
    expect(shownEffort(p)).toBe('low')
    expect(await send(p, 'l1')).toMatchObject({ reasoning: { effort: 'low' } })
    p.controller.dispose()
  })
})

describe('Fast tier follows the panel (R3)', () => {
  it('the session itself drops Fast at its model change, whoever asked for it', async () => {
    // No panel here: the host's own boundary. A caller that sets the tier and
    // switches models, then back, must not find the tier still on.
    const p = panel()
    const session = await p.host.startSession({
      modelId: FAST_MODEL,
      approvalMode: 'denyUnmatched',
      workspaceRoot: workspace,
    })
    await session.setServiceTier?.('priority')
    await session.setModel(PLAIN_MODEL)
    await session.setModel(FAST_MODEL)
    await session.sendTurn([{ type: 'text', text: 'hi' }])
    await vi.waitFor(() => {
      expect(p.bodies).toHaveLength(1)
    })
    expect(p.bodies[0]).toMatchObject({ model: 'gpt-6.1-sol' })
    expect(p.bodies[0]).not.toHaveProperty('service_tier')
    await p.host.close()
  })

  it('carries no service_tier after switching A (Fast on), B, then A again', async () => {
    const p = panel()
    expect(await send(p, 'l0')).not.toHaveProperty('service_tier')
    await p.controller.handle({ type: 'setFast', enabled: true })
    expect(shownFast(p)).toBe(true)
    // Fast on rides as the catalogue's priority tier: the drill's proof that
    // this harness would see a tier that leaked.
    expect(await send(p, 'l1')).toMatchObject({ model: 'gpt-6.1-sol', service_tier: 'priority' })
    await p.controller.handle({ type: 'setModel', modelId: PLAIN_MODEL })
    expect(shownFast(p)).toBe(false)
    expect(await send(p, 'l2')).not.toHaveProperty('service_tier')
    await p.controller.handle({ type: 'setModel', modelId: FAST_MODEL })
    expect(shownFast(p)).toBe(false)
    const back = await send(p, 'l3')
    expect(back).toMatchObject({ model: 'gpt-6.1-sol' })
    expect(back).not.toHaveProperty('service_tier')
    p.controller.dispose()
  })

  it('starts a new conversation with Fast off in the panel and on the wire', async () => {
    const p = panel()
    await send(p, 'l0')
    await p.controller.handle({ type: 'setFast', enabled: true })
    expect(await send(p, 'l1')).toHaveProperty('service_tier', 'priority')
    await p.controller.handle({ type: 'clearConversation' })
    const fresh = await send(p, 'l2')
    expect(shownFast(p)).toBe(false)
    expect(fresh).not.toHaveProperty('service_tier')
    p.controller.dispose()
  })
})
