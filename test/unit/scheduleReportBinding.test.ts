// RA's production report binding over the real store, authority and
// occurrence files: durable occurrences, the live-grant authority, the
// adapter's pending refusal until M113's backend binds, the structural
// destination verdicts, and schedule_report through the shared creation
// funnel.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { AGENT_SCHEDULE_MIN_INTERVAL_MS, UI_TEXT } from '../../src/shared/constants'
import { Usd } from '../../src/shared/usd'
import type { ReportDeliveryPayload } from '../../src/core/reporting/destinations/types'
import type { ScheduledReportAction as RunnerReportAction } from '../../src/core/reporting/destinations/types'
import { ReportEmailDelivery } from '../../src/core/reporting/destinations/email'
import { ReportPostDelivery } from '../../src/core/reporting/destinations/post'
import {
  scheduleReportResultsSchema,
  scheduleResponseSchema,
  scheduleV2Schema,
  type ScheduleDraft,
  type ScheduleReportAction,
  type ScheduleV2,
} from '../../src/shared/scheduleV2'
import { createScheduleStore, scheduleStorageHash } from '../../src/core/schedules/store'
import { ScheduleGrantEditor } from '../../src/core/schedules/grantAudit'
import { ScheduleReportActionRunner } from '../../src/core/schedules/reportAction'
import { collectingLogger } from './helpers/collectingLogger'
import {
  createScheduleReportPort,
  reportDestinationsAllowed,
} from '../../src/core/schedules/reportAdapter'
import { createReportOccurrencePort } from '../../src/core/schedules/reportOccurrences'
import { createScheduleReportAuthority } from '../../src/core/schedules/reportAuthority'
import {
  AgentScheduleTools,
  type AgentScheduleToolsDeps,
} from '../../src/core/schedules/agentTools'
import { createNodeScheduleFs } from '../../src/runtime/schedules/nodeScheduleFs'
import { createAuthorityStore } from '../../src/runtime/schedules/authorityStore'
import { scheduleFixture, runContextFixture } from './helpers/scheduleFixtures'
import { reportDocument } from './helpers/reporting/kindFixtures'

const folders: string[] = []
afterEach(async () => {
  while (folders.length > 0) {
    const folder = folders.pop()
    if (folder !== undefined) await rm(folder, { recursive: true, force: true })
  }
})

async function tempDir(prefix: string): Promise<string> {
  const folder = await mkdtemp(path.join(tmpdir(), prefix))
  folders.push(folder)
  return folder
}

const OCCURRENCE = '2026-10-22T12:00:00.000Z'

function reportAction(): ScheduleReportAction {
  return {
    kind: 'report',
    reportKind: 'project',
    args: {},
    format: 'markdown',
    destinations: [{ id: 'dest-1', kind: 'browser', location: 'local', whenInactive: 'wait' }],
  }
}

function reportSchedule(id: string): ScheduleV2 & { action: ScheduleReportAction } {
  const job = scheduleFixture({
    id,
    workspaceKey: 'workspace-1',
    action: reportAction(),
    grant: { rules: [], destinationIds: ['dest-1'], paidCapUsd: Usd.from(0).toAmount() },
  })
  if (job.action.kind !== 'report') throw new Error('fixture must run a report')
  return { ...job, action: job.action }
}

function runnerAction(ids: readonly string[]): RunnerReportAction {
  return {
    type: 'report',
    options: {
      kind: 'project',
      asOf: OCCURRENCE,
      scope: 'fixture-workspace',
      full: false,
      network: false,
      failOn: [],
    },
    format: 'md',
    locale: 'en',
    theme: {
      background: '#ffffff',
      foreground: '#000000',
      muted: '#666666',
      border: '#cccccc',
      accent: '#0000ff',
    },
    destinations: ids.map((id) => ({ type: 'browser', id, storage: 'local' }) as const),
  }
}

function occurrencePayload(): ReportDeliveryPayload {
  const document = reportDocument()
  return {
    document,
    format: 'md',
    locale: 'en',
    theme: {
      background: '#ffffff',
      foreground: '#000000',
      muted: '#666666',
      border: '#cccccc',
      accent: '#0000ff',
    },
    attachment: '',
    html: '',
    text: '',
    markdown: '',
  }
}

describe('durable report occurrences', () => {
  it('round-trips a frozen payload across instances', async () => {
    const root = await tempDir('schedule-report-occ-')
    const fs = createNodeScheduleFs(root)
    const first = createReportOccurrencePort(fs)
    await first.exclusive('schedule-1', OCCURRENCE, async () => {
      await first.write('schedule-1', OCCURRENCE, {
        actionKey: 'a'.repeat(64),
        payload: occurrencePayload(),
        outcomes: {},
      })
    })
    const second = createReportOccurrencePort(createNodeScheduleFs(root))
    const record = await second.read('schedule-1', OCCURRENCE)
    expect(record?.payload.document.header.kind).toBe('project')
    expect(record?.outcomes).toEqual({})
    expect(await second.read('schedule-1', '2026-10-23T12:00:00.000Z')).toBe(null)
  })

  it('serializes concurrent occurrence writers', async () => {
    const root = await tempDir('schedule-report-serial-')
    const port = createReportOccurrencePort(createNodeScheduleFs(root))
    const order: string[] = []
    const gate = Promise.withResolvers<boolean>()
    const first = port.exclusive('schedule-1', OCCURRENCE, async () => {
      order.push('first-in')
      await gate.promise
      await port.write('schedule-1', OCCURRENCE, {
        actionKey: 'a'.repeat(64),
        payload: occurrencePayload(),
        outcomes: {},
      })
      order.push('first-out')
    })
    for (let attempt = 0; attempt < 200 && !order.includes('first-in'); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
    expect(order).toEqual(['first-in'])
    const second = port.exclusive('schedule-1', OCCURRENCE, async () => {
      order.push('second-in')
      const record = await port.read('schedule-1', OCCURRENCE)
      if (record !== null) {
        await port.write('schedule-1', OCCURRENCE, {
          ...record,
          outcomes: { 'dest-1': { status: 'delivered', attempts: 1 } },
        })
      }
      order.push('second-out')
    })
    // The second writer must not enter while the first holds the lock.
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(order).toEqual(['first-in'])
    gate.resolve(true)
    await Promise.all([first, second])
    expect(order).toEqual(['first-in', 'first-out', 'second-in', 'second-out'])
    const record = await port.read('schedule-1', OCCURRENCE)
    expect(record?.outcomes['dest-1']).toEqual({ status: 'delivered', attempts: 1 })
  })

  it('refuses a corrupt occurrence file instead of running from it', async () => {
    const root = await tempDir('schedule-report-corrupt-')
    const port = createReportOccurrencePort(createNodeScheduleFs(root))
    await port.write('schedule-1', OCCURRENCE, {
      actionKey: 'b'.repeat(64),
      payload: occurrencePayload(),
      outcomes: {},
    })
    const { writeFile } = await import('node:fs/promises')
    const hash = scheduleStorageHash(OCCURRENCE)
    await writeFile(
      path.join(
        root,
        'reports',
        scheduleStorageHash('schedule-1'),
        hash.slice(0, 2),
        `${hash}.json`,
      ),
      '{not json',
    )
    await expect(port.read('schedule-1', OCCURRENCE)).rejects.toThrow('scheduleStoredJsonInvalid')
  })
})

describe('live report authority', () => {
  it('authorizes covered destinations with live roots and no network', async () => {
    const root = await tempDir('schedule-report-auth-')
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const authorityStore = createAuthorityStore(store, fs, 'runtime/grant-audits.json')
    const job = scheduleFixture({
      id: 'schedule-1',
      workspaceKey: 'workspace-1',
      action: reportAction(),
      grant: {
        rules: [{ id: 'rule-1', kind: 'path', glob: 'docs/**', access: 'read' }],
        destinationIds: ['dest-1'],
        paidCapUsd: Usd.from(0).toAmount(),
      },
    })
    await authorityStore.commit(job, { scheduleId: job.id, atMs: 1, kind: 'created' })
    const authority = createScheduleReportAuthority({
      authority: authorityStore,
      workspaceKey: 'workspace-1',
      workspaceRoot: root,
    })
    const verdict = await authority.authorize('schedule-1', runnerAction(['dest-1']))
    expect(verdict.allowed).toBe(true)
    if (!verdict.allowed) throw new Error('authority must allow covered destinations')
    expect(verdict.roots).toEqual([path.join(root, 'docs')])
    expect(verdict.network).toBe(false)
    expect(verdict.creator).toBe('user')
  })

  it('denies paused, revoked, uncovered and unknown schedules', async () => {
    const root = await tempDir('schedule-report-deny-')
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const authorityStore = createAuthorityStore(store, fs, 'runtime/grant-audits.json')
    const editor = new ScheduleGrantEditor(authorityStore, Date.now)
    const job = reportSchedule('schedule-1')
    await editor.create(job)
    const authority = createScheduleReportAuthority({
      authority: authorityStore,
      workspaceKey: 'workspace-1',
      workspaceRoot: root,
    })
    async function isAllowed(scheduleId: string, ids: readonly string[]): Promise<boolean> {
      const verdict = await authority.authorize(scheduleId, runnerAction(ids))
      return verdict.allowed
    }
    expect(await isAllowed('schedule-1', ['dest-1'])).toBe(true)
    expect(await isAllowed('schedule-1', ['dest-9'])).toBe(false)
    expect(await isAllowed('schedule-9', ['dest-1'])).toBe(false)
    const stored = await authorityStore.read('workspace-1', 'schedule-1')
    if (stored === undefined) throw new Error('schedule must exist')
    expect(await store.update(scheduleV2Schema.parse({ ...stored, paused: true }))).toBe(true)
    expect(await isAllowed('schedule-1', ['dest-1'])).toBe(false)
    const paused = await authorityStore.read('workspace-1', 'schedule-1')
    if (paused === undefined) throw new Error('schedule must exist')
    expect(await store.update(scheduleV2Schema.parse({ ...paused, paused: false }))).toBe(true)
    expect(await editor.revoke('workspace-1', 'schedule-1')).toBe(true)
    expect(await isAllowed('schedule-1', ['dest-1'])).toBe(false)
  })
})

describe('report adapter without a backend', () => {
  it('reports pending availability and the runner refuses with its sentence', async () => {
    const root = await tempDir('schedule-report-pending-')
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const authorityStore = createAuthorityStore(store, fs, 'runtime/grant-audits.json')
    const job = reportSchedule('schedule-1')
    await authorityStore.commit(job, { scheduleId: job.id, atMs: 1, kind: 'created' })
    const port = createScheduleReportPort({
      store,
      authorityStore,
      occurrences: createReportOccurrencePort(fs),
      locale: 'en',
      roots: (workspace) => Promise.resolve(workspace === 'workspace-1' ? root : undefined),
    })
    expect(port.availability?.()).toEqual({
      available: false,
      reason: UI_TEXT.scheduleV2.reportAction.destinationsPending,
    })
    const audited: unknown[] = []
    const runner = new ScheduleReportActionRunner({
      store,
      reports: port,
      audit: (entry) => {
        audited.push(entry)
        return Promise.resolve()
      },
      log: collectingLogger([]),
      now: () => 1_700_000_000_000,
    })
    const [stored] = await store.list('workspace-1')
    if (stored === undefined) throw new Error('schedule must exist')
    const result = await runner.run(stored, runContextFixture(stored), 1_700_000_060_000)
    expect(result.outcome).toBe('refused')
    expect(result.reason).toBe(UI_TEXT.scheduleV2.reportAction.destinationsPending)
    // Refused before dispatch: no grant-use audit, no occurrence file.
    expect(audited).toEqual([])
  })

  it('throws for unknown schedules and edited-away report actions', async () => {
    const root = await tempDir('schedule-report-throw-')
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const authorityStore = createAuthorityStore(store, fs, 'runtime/grant-audits.json')
    const port = createScheduleReportPort({
      store,
      authorityStore,
      occurrences: createReportOccurrencePort(fs),
      locale: 'en',
      roots: () => Promise.resolve(root),
    })
    const missing = reportSchedule('schedule-9')
    await expect(port.run(missing, runContextFixture(missing), OCCURRENCE)).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.invalidRequest,
    )
    const job = reportSchedule('schedule-1')
    await store.create(job)
    const [live] = await store.list('workspace-1')
    if (live === undefined) throw new Error('schedule must exist')
    await store.update(
      scheduleV2Schema.parse({ ...live, action: { kind: 'prompt', prompt: 'edited away' } }),
    )
    await expect(port.run(job, runContextFixture(job), OCCURRENCE)).rejects.toThrow(
      UI_TEXT.scheduleV2.runtime.invalidRequest,
    )
  })
})

describe('report adapter with a bound backend', () => {
  it('translates the live action and honors a revoked grant without generating', async () => {
    const root = await tempDir('schedule-report-bound-')
    const fs = createNodeScheduleFs(root)
    const store = createScheduleStore(fs)
    const authorityStore = createAuthorityStore(store, fs, 'runtime/grant-audits.json')
    const editor = new ScheduleGrantEditor(authorityStore, Date.now)
    const job = reportSchedule('schedule-1')
    await editor.create(job)
    const translated: { action: ScheduleReportAction; locale: string }[] = []
    const unreachable = () => Promise.reject(new Error('must not run while revoked'))
    const port = createScheduleReportPort({
      store,
      authorityStore,
      occurrences: createReportOccurrencePort(fs),
      backend: {
        translate: (action, context) => {
          translated.push({ action, locale: context.locale })
          return Promise.resolve(runnerAction(action.destinations.map((item) => item.id)))
        },
        runner: {
          generation: { generate: unreachable },
          locale: { textForLocale: () => UI_TEXT },
          redaction: { workspaceRoot: root, localRoots: [] },
          email: new ReportEmailDelivery(
            {
              isRecipientAllowed: unreachable,
              connectionPolicy: unreachable,
              send: unreachable,
              confirmFirstSend: unreachable,
            },
            { update: unreachable },
            Date.now,
          ),
          post: new ReportPostDelivery({
            isEnabled: unreachable,
            isConfirmed: unreachable,
            previewAndConfirm: unreachable,
            rememberConfirmation: unreachable,
            publish: unreachable,
          }),
          browser: {
            publishHtml: unreachable,
            hasActiveSession: unreachable,
            isAuthenticatedReportUrl: unreachable,
            open: unreachable,
          },
          saveExclusive: unreachable,
          nodeSave: unreachable,
          sleep: () => Promise.resolve(),
        },
      },
      locale: 'en',
      roots: () => Promise.resolve(root),
    })
    // Edit the live action, then revoke: the backend sees the live edit,
    // and the revoked grant refuses every destination before generation.
    const stored = await authorityStore.read('workspace-1', 'schedule-1')
    if (stored?.action.kind !== 'report') throw new Error('schedule must exist')
    await store.update(
      scheduleV2Schema.parse({
        ...stored,
        action: {
          ...stored.action,
          args: { module: 'edited-live' },
        },
      }),
    )
    expect(await editor.revoke('workspace-1', 'schedule-1')).toBe(true)
    const [live] = await store.list('workspace-1')
    if (live?.action.kind !== 'report') throw new Error('schedule must run a report')
    const narrowed = { ...live, action: live.action }
    const receipts = scheduleReportResultsSchema.parse(
      await port.run(narrowed, runContextFixture(narrowed), OCCURRENCE),
    )
    expect(translated).toHaveLength(1)
    expect(translated[0]?.action.args).toEqual({ module: 'edited-live' })
    expect(translated[0]?.locale).toBe('en')
    expect(receipts).toEqual({ 'dest-1': { status: 'refused', attempts: 0 } })
  })
})

function verdictFor(destination: ScheduleReportAction['destinations'][number]) {
  return reportDestinationsAllowed({ ...reportAction(), destinations: [destination] })
}

describe('report destination verdicts', () => {
  const pending = {
    allowed: false as const,
    reason: UI_TEXT.scheduleV2.reportAction.destinationsPending,
  }
  it('allows complete browser and github-post targets, pending everything opaque', () => {
    expect(verdictFor({ id: 'd', kind: 'browser', location: 'local', whenInactive: 'wait' })).toBe(
      true,
    )
    expect(
      verdictFor({
        id: 'd',
        kind: 'post',
        provider: 'github',
        repository: 'owner/repo',
        target: 'issue',
      }),
    ).toBe(true)
    expect(
      verdictFor({
        id: 'd',
        kind: 'save',
        rootId: 'root-1',
        directory: 'reports',
        nameTemplate: 'n',
        retention: 30,
      }),
    ).toEqual(pending)
    expect(verdictFor({ id: 'd', kind: 'email', recipientId: 'r', connectionId: 'c' })).toEqual(
      pending,
    )
    expect(
      verdictFor({
        id: 'd',
        kind: 'post',
        provider: 'gitlab',
        repository: 'owner/repo',
        target: 'issue',
      }),
    ).toEqual(pending)
    expect(
      verdictFor({
        id: 'd',
        kind: 'post',
        provider: 'github',
        repository: 'not-a-repo',
        target: 'issue',
      }),
    ).toEqual(pending)
    expect(
      verdictFor({
        id: 'd',
        kind: 'cloud',
        availability: 'planned',
        provider: 's3',
        connectionId: 'c',
        folderId: 'f',
      }),
    ).toEqual(pending)
    expect(
      verdictFor({
        id: 'd',
        kind: 'sms',
        availability: 'planned',
        recipientId: 'r',
        connectionId: 'c',
      }),
    ).toEqual(pending)
  })
})

type TranscriptRow = Parameters<AgentScheduleToolsDeps['transcript']>[0]

function harness(
  root: string,
  committed: { current: boolean },
  transcripts: TranscriptRow[],
): {
  store: ReturnType<typeof createScheduleStore>
  tools: AgentScheduleTools
  deps: AgentScheduleToolsDeps
} {
  const fs = createNodeScheduleFs(root)
  const store = createScheduleStore(fs)
  const grant = {
    rules: [],
    destinationIds: ['dest-1'],
    paidCapUsd: Usd.from(0).toAmount(),
  }
  const deps: AgentScheduleToolsDeps = {
    admission: {
      store,
      exclusive: <T>(_workspaceKey: string, operation: () => Promise<T>) => operation(),
      policy: () =>
        Promise.resolve({
          choice: 'always' as const,
          paidCapUsd: Usd.from(0).toAmount(),
          revision: 0,
        }),
      dailyUsage: () =>
        Promise.resolve({
          settledUsd: Usd.from(0).toAmount(),
          uncertainUsd: Usd.from(0).toAmount(),
        }),
      remember: () => Promise.resolve(true),
      commit: async (schedule: ScheduleV2) => {
        const isAdmitted = committed.current
        if (isAdmitted) await store.create(schedule)
        return isAdmitted
          ? { committed: true as const }
          : { committed: false as const, reason: 'budget' as const }
      },
    },
    authority: () =>
      Promise.resolve({
        creator: { kind: 'agent' as const, agentId: 'a', sessionId: 's', orchestratorId: 'o' },
        workspaceKey: 'workspace-1',
        role: 'lead' as const,
        charterAllowsScheduling: true,
        execution: 'interactive' as const,
        enabled: true,
        active: true,
        mode: 'manual' as const,
        grant,
        paidCapUsd: Usd.from(0).toAmount(),
        depth: 0,
      }),
    canTarget: () => Promise.resolve(true),
    effectiveGrant: () => Promise.resolve(grant),
    minimumSpacing: () => Promise.resolve(AGENT_SCHEDULE_MIN_INTERVAL_MS),
    consent: () => Promise.reject(new Error('policy is always; consent must not run')),
    paidConsent: () => Promise.reject(new Error('paid cap is zero; paid consent must not run')),
    ownerActive: () => Promise.resolve(true),
    transcript: (row) => {
      transcripts.push(row)
    },
    now: () => 1_700_000_000_000,
    descriptions: { prompt: 'prompt', list: 'list', cancel: 'cancel', report: 'report' },
  }
  const tools = new AgentScheduleTools(deps)
  return { store, tools, deps }
}

function draft(): ScheduleDraft {
  return {
    name: 'Morning report',
    action: reportAction(),
    trigger: { kind: 'once', atMs: 1_800_000_000_000 },
    target: { kind: 'newConversation', backend: 'modelApi' },
    delivery: 'newConversation',
    whenClosed: 'open',
    catchUp: 'runOnce',
    mode: 'manual',
    grant: {
      rules: [],
      destinationIds: ['dest-1'],
      paidCapUsd: Usd.from(0).toAmount(),
    },
    paidCapUsd: Usd.from(0).toAmount(),
    parallel: false,
    zone: 'UTC',
    pinned: false,
  }
}

describe('schedule_report through the agent tools', () => {
  it('lists schedule_report only when the report port is bound', async () => {
    const root = await tempDir('schedule-report-tools-')
    const committed = { current: true }
    const transcripts: TranscriptRow[] = []
    const { tools, deps } = harness(root, committed, transcripts)
    const names = await tools.definitions()
    expect(names.map((item) => item.name)).toEqual([
      'schedule_prompt',
      'schedule_list',
      'schedule_cancel',
    ])
    const bound = new AgentScheduleTools({
      ...deps,
      report: { port: tools.reportPort() },
    })
    const boundNames = await bound.definitions()
    expect(boundNames.map((item) => item.name)).toEqual([
      'schedule_prompt',
      'schedule_list',
      'schedule_cancel',
      'schedule_report',
    ])
  })

  it('creates a report schedule through the shared funnel', async () => {
    const root = await tempDir('schedule-report-create-')
    const committed = { current: true }
    const transcripts: TranscriptRow[] = []
    const { store, tools, deps } = harness(root, committed, transcripts)
    const bound = new AgentScheduleTools({
      ...deps,
      report: { port: tools.reportPort() },
    })
    const signal = new AbortController().signal
    const result = await bound.call('schedule_report', { draft: draft() }, signal)
    expect(result.outcome).toBe('created')
    if (result.outcome !== 'created') throw new Error('must create')
    const [created] = await store.list('workspace-1')
    expect(created?.action.kind).toBe('report')
    expect(created?.grant.destinationIds).toEqual(['dest-1'])
    expect(transcripts).toHaveLength(1)
    expect(transcripts[0]?.outcome).toBe('created')
    expect(transcripts[0]?.scheduleId).toBe(created?.id)
    expect(created?.creator).toEqual({
      kind: 'agent',
      agentId: 'a',
      sessionId: 's',
      orchestratorId: 'o',
    })
  })

  it('refuses opaque destinations, prompt drafts and missing ports', async () => {
    const root = await tempDir('schedule-report-refuse-')
    const committed = { current: true }
    const transcripts: TranscriptRow[] = []
    const { tools, deps } = harness(root, committed, transcripts)
    const bound = new AgentScheduleTools({
      ...deps,
      report: { port: tools.reportPort() },
    })
    const signal = new AbortController().signal
    const opaque = {
      ...draft(),
      action: {
        ...reportAction(),
        destinations: [
          {
            id: 'dest-1',
            kind: 'save',
            rootId: 'root-1',
            directory: 'r',
            nameTemplate: 'n',
            retention: 1,
          },
        ],
      },
    }
    expect(await bound.call('schedule_report', { draft: opaque }, signal)).toEqual({
      outcome: 'refused',
      reason: 'unavailable',
    })
    const prompt = { ...draft(), action: { kind: 'prompt' as const, prompt: 'hello' } }
    expect(await bound.call('schedule_report', { draft: prompt }, signal)).toEqual({
      outcome: 'refused',
      reason: 'invalid',
    })
    expect(await tools.call('schedule_report', { draft: draft() }, signal)).toEqual({
      outcome: 'refused',
      reason: 'unavailable',
    })
    expect(transcripts.map((row) => row.outcome)).toEqual(['refused', 'refused', 'refused'])
  })

  it('maps admission through the standalone port', async () => {
    const root = await tempDir('schedule-report-admit-')
    const committed = { current: true }
    const transcripts: TranscriptRow[] = []
    const { tools } = harness(root, committed, transcripts)
    const port = tools.reportPort()
    expect(await port.destinationsAllowed(reportAction())).toBe(true)
    const accepted = scheduleResponseSchema.parse(await port.admit(draft()))
    expect(accepted.kind).toBe('accepted')
    expect(accepted.kind === 'accepted' ? typeof accepted.id : undefined).toBe('string')
    committed.current = false
    const refused = scheduleResponseSchema.parse(await port.admit(draft()))
    expect(refused.kind).toBe('refused')
    expect(refused.kind === 'refused' ? refused.reason : '').toContain('budget')
    const prompt = { ...draft(), action: { kind: 'prompt' as const, prompt: 'hello' } }
    await expect(port.admit(prompt)).rejects.toThrow(UI_TEXT.scheduleV2.runtime.invalidRequest)
  })
})
