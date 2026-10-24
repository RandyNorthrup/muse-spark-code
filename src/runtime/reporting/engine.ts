import { readReportSource } from '../../core/reporting/sources/boundary'
import reportThemes from '../../../design/tokens/generated/report-themes.json'
import { homedir } from 'node:os'
import {
  REPORT_EMPTY_HASH,
  REPORT_NEXT_STEP_LIMIT,
  REPORT_FORMAT_VERSION,
  type REPORT_FAIL_ON,
} from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import { reportDiffSchema, type ReportDocument, type ReportKind } from '../../shared/reportSchema'
import type {
  ReportSourceKind,
  CheckRunRecord,
  ReportSourcePorts,
  SourceSnapshot,
} from '../../core/reporting/sources/types'
import {
  localSource,
  LocalSourceError,
  reportWorkspaceKey,
} from '../../core/reporting/sources/local'
import {
  keybindingsSource,
  type KeybindingsManifestReader,
} from '../../core/reporting/sources/keybindings'
import type { LocalReportSourceDeps } from '../../core/reporting/sources'
import { emptyPlanFacts, readPlan } from '../../core/reporting/plan/reader'
import { createReportCollector } from '../../core/reporting/collect'
import { ReportScopeNotFound } from '../../core/reporting/collect/plan'
import type { PlaybookReportOrderer } from '../../core/reporting/collect/playbookOrder'
import { createReportRenderers } from '../../core/reporting/render'
import {
  canonicalReportJson,
  finalizeReport,
  verifyReport,
} from '../../core/reporting/render/canonical'
import { reportScrubber, scrubSourceSnapshot } from '../../core/reporting/render/redaction'
import { compareReports, reportDiffNotice, reportDiffSection } from '../../core/reporting/diff'
import { ReportStorage, ReportHistory } from '../../core/reporting/history'
import { CheckRunJournal } from '../../core/reporting/checkRuns'
import { createRuntimeReportSources, reportFileIo, reportGitIo } from './sources'
import { readStoreProject } from '../../core/reporting/sources/storeProject'
import type { ReportingNetworkContext } from './network'
import { reportingNetworkLoader } from './networkLoader'
import type { Logger } from '../../host/logger'
import { readReportSelections } from './selections'
import { createReportsHost } from './reportsHost'
import type { ReportsServices } from './reportsCommand'
import type { ReportGenerationPort } from '../../core/reporting/destinations/types'
import type { ReportPanelEngine } from '../../shared/reportingEngine'

export interface ReportingContext {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly l10n: { readonly table: UiText; readonly locale: string }
  readonly generatorVersion: string
  readonly log?: Logger
  readonly keepHistory: boolean
  /**
  D121: the person's own plan byte limit, 0 or absent meaning none. The
  plan reads whole however large unless this is set; past it the parse
  refuses with `input-size` drift naming this limit.
  */
  readonly planMaxBytes?: number
  readonly enabledAgents: LocalReportSourceDeps['enabledAgents']
  readonly session?: LocalReportSourceDeps['session']
  readonly questions?: LocalReportSourceDeps['questions']
  readonly usage?: LocalReportSourceDeps['usage']
  /** The installed manifest's reader; absent stays unbound (M113 C-M113-5). */
  readonly keybindings?: KeybindingsManifestReader

  readonly accounts?: LocalReportSourceDeps['accounts']
  readonly security?: LocalReportSourceDeps['security']
  /** Normalized source ports shared by embedded hosts and engine certification. */
  readonly sources?: Partial<ReportSourcePorts>
  readonly playbook?: LocalReportSourceDeps['playbook']
  /**
  D220: the playbook ordering for the playbook, milestone and fleet kinds,
  over the journal the report reads, bound by the facades. Asked for only
  when one of those kinds orders, so no other report loads the inputs
  bundle it lives in. Absent, those kinds keep their own order; the note
  goes to this context's log.
  */
  readonly playbookOrder?: (() => PlaybookReportOrderer) | undefined
  readonly schedules?: LocalReportSourceDeps['schedules']
  readonly estimate?: LocalReportSourceDeps['estimate']
  readonly networkSources?: Pick<ReportSourcePorts, 'github' | 'stores'>
  readonly network?:
    | Omit<ReportingNetworkContext, 'workspaceRoot' | 'storageRoot' | 'l10n'>
    | (() => Promise<Omit<ReportingNetworkContext, 'workspaceRoot' | 'storageRoot' | 'l10n'>>)
  /**
  Told the observed CI check runs after a generation that attempted the
  github read (M116, PLAN.md D218): how many ran, or that the read failed.
  A generation that never attempted the read calls nothing, so a holder
  fed here stays unknown until CI is really observed, never guessed.
  */
  readonly noteGithubCi?:
    ((outcome: { readonly runs: number } | { readonly failed: true }) => void) | undefined
}

const unavailable = <K extends ReportSourceKind>(kind: K) =>
  localSource(kind, () => Promise.reject(new LocalSourceError('unbound')))

const logUnavailable = () => {
  throw new LocalSourceError('unbound')
}

/** One lazy pipeline for every host. Missing adapters fail as named sources. */
export function createReportingServices(context: ReportingContext): ReportsServices {
  setUiText(context.l10n.table, context.l10n.locale)
  const root = context.workspaceRoot
  const workspaceKey = root === undefined ? undefined : reportWorkspaceKey(root, process.platform)
  const redaction = { ...(root !== undefined && { workspaceRoot: root }), localRoots: [homedir()] }
  const scrub = reportScrubber(redaction)
  const storage = new ReportStorage(context.storageRoot)
  const history = new ReportHistory({
    storage,
    keepHistory: () => context.keepHistory,
    codec: {
      encode: (doc) => canonicalReportJson(doc, redaction),
      decode: (text) => verifyReport(JSON.parse(text), redaction),
    },
    authorize: (scope) => {
      return scope.workspaceKey === workspaceKey
        ? Promise.resolve()
        : Promise.reject(new Error(context.l10n.table.reportUi.generationFailed))
    },
  })
  const render = createReportRenderers({ textForLocale: () => context.l10n.table }, redaction)
  const missingSelection = () => ({
    record: {
      id: 'gitSelection',
      status: 'unavailable' as const,
      reason: context.l10n.table.reportSourceReasons.unbound,
      observedAt: null,
      freshness: { state: 'unknown' as const, ageMs: null },
    },
    data: null,
  })
  const requiredKey = () => {
    if (workspaceKey === undefined) throw new Error(context.l10n.table.reportUi.generationFailed)
    return workspaceKey
  }
  return {
    async generate(options, signal = new AbortController().signal) {
      const reportText = { ...context.l10n.table }
      const locale = context.l10n.locale
      let boundNetwork: Pick<ReportSourcePorts, 'github' | 'stores'> | undefined
      const key = requiredKey()
      const local =
        root === undefined
          ? undefined
          : createRuntimeReportSources({
              workspaceRoot: root,
              homeDir: homedir(),
              platform: process.platform,
              env: process.env,
              scrub,
              enabledAgents: context.enabledAgents,
              ...(context.session !== undefined && { session: context.session }),
              ...(context.questions !== undefined && { questions: context.questions }),
              ...(context.usage !== undefined && { usage: context.usage }),
              ...(context.accounts !== undefined && { accounts: context.accounts }),
              ...(context.security !== undefined && { security: context.security }),
              ...(context.playbook !== undefined && { playbook: context.playbook }),
              ...(context.schedules !== undefined && { schedules: context.schedules }),
              ...(context.estimate !== undefined && { estimate: context.estimate }),
            }).sources
      // One signal for the whole generation, the caller's: every source
      // observes the same abort (the person's cancel), no deadline of ours
      // ends a read (D121/D208), and the engine awaits each read's own
      // settlement, never racing it.
      const readContext = {
        reportText,
        locale,
        run: {},
        options,
        asOf: options.asOf,
        workspaceKey: key,
        signal,
      }
      let planText: string | undefined
      const sources: ReportSourcePorts = {
        git: local?.git ?? unavailable('git'),
        package: local?.package ?? unavailable('package'),
        changelog: local?.changelog ?? unavailable('changelog'),
        certification: local?.certification ?? unavailable('certification'),
        session: local?.session ?? unavailable('session'),
        questions: local?.questions ?? unavailable('questions'),
        usage: local?.usage ?? unavailable('usage'),
        agentUsage: local?.agentUsage ?? unavailable('agentUsage'),
        github: context.networkSources?.github ?? unavailable('github'),
        stores: context.networkSources?.stores ?? unavailable('stores'),
        checkRuns: new CheckRunJournal({ storage, scrub }).source(),
        fleet: unavailable('fleet'),
        security: local?.security ?? unavailable('security'),
        accounts: local?.accounts ?? unavailable('accounts'),
        estimate: local?.estimate ?? unavailable('estimate'),
        playbook: local?.playbook ?? unavailable('playbook'),
        issues: unavailable('issues'),
        schedules: local?.schedules ?? unavailable('schedules'),
        keybindings:
          context.keybindings === undefined
            ? unavailable('keybindings')
            : keybindingsSource(context.keybindings),
        plan: localSource('plan', async ({ signal: planSignal }) => {
          if (root === undefined) throw new LocalSourceError('unbound')
          // D121: no limit of ours — the read streams the whole file the way
          // the rest of the product reads whole files. Only the person's own
          // planMaxBytes, applied at the parse below, can refuse it.
          const text = await reportFileIo(root, process.platform).read('PLAN.md', planSignal)
          planText = scrub(text)
          // The single parse happens below with lane evidence (branches,
          // pull requests, certification paths); this read only carries the
          // text, so a multi-megabyte plan is parsed once per report instead
          // of twice (RVCM1132D finding 4).
          return { data: emptyPlanFacts() }
        }),
        ...context.sources,
      }
      // All reads share the request stamp; source ports observe cancellation.
      const [
        initialPlan,
        pkg,
        git,
        changelog,
        certification,
        session,
        questions,
        usage,
        agentUsage,
        checkRuns,
        githubLocal,
        storesLocal,
        fleet,
        security,
        accounts,
        estimate,
        playbook,
        issues,
        schedules,
        keybindings,
      ] = await Promise.all([
        readReportSource('plan', sources.plan, readContext),
        readReportSource('package', sources.package, readContext),
        readReportSource('git', sources.git, readContext),
        readReportSource('changelog', sources.changelog, readContext),
        readReportSource('certification', sources.certification, readContext),
        readReportSource('session', sources.session, readContext),
        readReportSource('questions', sources.questions, readContext),
        readReportSource('usage', sources.usage, readContext),
        readReportSource('agentUsage', sources.agentUsage, readContext),
        readReportSource('checkRuns', sources.checkRuns, readContext),
        readReportSource('github', sources.github, readContext),
        readReportSource('stores', sources.stores, readContext),
        readReportSource('fleet', sources.fleet, readContext),
        readReportSource('security', sources.security, readContext),
        readReportSource('accounts', sources.accounts, readContext),
        readReportSource('estimate', sources.estimate, readContext),
        readReportSource('playbook', sources.playbook, readContext),
        readReportSource('issues', sources.issues, readContext),
        readReportSource('schedules', sources.schedules, readContext),
        readReportSource('keybindings', sources.keybindings, readContext),
      ])
      const latestGit = git.data
      const activeNetwork =
        typeof context.network === 'function' ? await context.network() : context.network
      // Workspace identity is read on every networked report, never latched:
      // a version bump or a newly declared manifest shows up on the next
      // refresh of the long-lived editor engine (RVCM1136 P2). The response
      // cache stays shared by storage root; only the binding is rebuilt.
      if (
        root !== undefined &&
        activeNetwork !== undefined &&
        context.networkSources === undefined &&
        activeNetwork.policy.mode !== 'off' &&
        (activeNetwork.policy.surface === 'editor' || options.network)
      ) {
        const storeProject = await readStoreProject(() =>
          reportFileIo(root, process.platform).read('package.json', readContext.signal),
        )
        const policy = activeNetwork.policy
        boundNetwork = reportingNetworkLoader(
          context.log ?? {
            trace: logUnavailable,
            info: logUnavailable,
            warn: logUnavailable,
            error: logUnavailable,
          },
        )().createReportingNetwork(
          {
            workspaceRoot: root,
            storageRoot: context.storageRoot,
            l10n: { table: reportText, locale },
            policy,
            ...(activeNetwork.transport !== undefined && { transport: activeNetwork.transport }),
          },
          () => latestGit,
          storeProject,
        )
      }
      const network =
        activeNetwork !== undefined &&
        (activeNetwork.policy.surface === 'editor' || options.network)
          ? boundNetwork
          : undefined
      const [github, stores] =
        network === undefined
          ? [githubLocal, storesLocal]
          : await Promise.all([
              readReportSource('github', network.github, readContext),
              readReportSource('stores', network.stores, readContext),
            ])
      // D218: only a generation that really attempted the github read feeds
      // the CI holder: the bound network, or an owner-supplied github port.
      // Anything else leaves unknown alone.
      if (network !== undefined || context.networkSources?.github !== undefined)
        context.noteGithubCi?.(
          github.data === null ? { failed: true } : { runs: github.data.runs.length },
        )
      const plan =
        planText === undefined || initialPlan.data === null
          ? initialPlan
          : {
              ...initialPlan,
              data: readPlan(
                planText,
                {
                  ...(git.data !== null && { branches: git.data.branches }),
                  ...(github.data !== null && {
                    pullRequests: github.data.pullRequests.map((pull) => ({
                      branch: pull.headRef,
                      number: pull.number,
                      state: pull.state,
                    })),
                  }),
                  ...(certification.data !== null && {
                    certificationPaths: certification.data.records.map((record) => record.path),
                  }),
                },
                context.planMaxBytes ?? 0,
              ).facts,
            }
      signal.throwIfAborted()
      const snapshot: SourceSnapshot = {
        asOf: options.asOf,
        workspaceKey: key,
        generatorVersion: context.generatorVersion,
        rendererVersion: REPORT_FORMAT_VERSION,
        icuVersion: process.versions['icu'] ?? 'unknown',
        locale,
        sources: {
          plan,
          package: pkg,
          git,
          changelog,
          certification,
          session,
          questions,
          usage,
          agentUsage,
          checkRuns,
          github,
          stores,
          fleet,
          security,
          accounts,
          estimate,
          playbook,
          issues,
          schedules,
          keybindings,
        },
      }
      const clean = scrubSourceSnapshot(snapshot, redaction)
      const selections =
        root === undefined
          ? {
              changes: missingSelection,
              changeBranches: missingSelection,
              risksSinceRelease: missingSelection,
            }
          : await readReportSelections(
              clean,
              options,
              reportGitIo(root, process.platform, process.env),
              signal,
              reportText,
            )
      const { playbookOrder } = context
      const collector = createReportCollector({
        nextStepLimit: REPORT_NEXT_STEP_LIMIT,
        selections,
        ...(playbookOrder !== undefined && {
          playbookOrder: {
            orderReport: (items) => playbookOrder().orderReport(items),
            getRecord: () => playbookOrder().getRecord(),
          },
          playbookNote: (note) => {
            context.log?.info(`playbook report order: ${note.rule}/${note.code}`)
          },
        }),
        finalize: (draft) =>
          finalizeReport(
            { ...draft, header: { ...draft.header, contentHash: REPORT_EMPTY_HASH } },
            redaction,
          ),
      })
      try {
        return {
          status: 'generated',
          document: collector(clean, options),
        }
      } catch (error) {
        if (error instanceof ReportScopeNotFound)
          return { status: 'notFound', id: error.scope, nearest: error.nearestIds }
        throw error
      }
    },
    history: {
      async list(kind: ReportKind) {
        const result = await history.history({ workspaceKey: requiredKey(), kind })
        if (result.status !== 'listed') throw new Error(result.reason)
        return result.entries
      },
      async get(kind: ReportKind, id: string) {
        const result = await history.get({ workspaceKey: requiredKey(), kind, id })
        if (result.status !== 'retrieved') throw new Error(result.reason)
        return result.document
      },
      async save(document: ReportDocument) {
        await history.save(requiredKey(), document)
      },
    },
    conditions: (document) => {
      const conditions: (typeof REPORT_FAIL_ON)[number][] = []
      if (document.sources.some((source) => source.status === 'unavailable'))
        conditions.push('unavailable')
      if (
        document.sections.some(
          (section) =>
            section.id === 'planFormat' &&
            section.rows.some(
              (row) =>
                row.cells['status']?.type === 'label' && row.cells['status'].value === 'partial',
            ),
        )
      )
        conditions.push('drift')
      for (const row of document.needsYou.rows) {
        const status = row.cells['status']
        if (status?.type !== 'label') continue
        if (status.value === 'open') conditions.push('blocked')
        else if (status.value === 'lagging') conditions.push('channelLag')
        else if (status.value === 'failed' && row.sourceIds.includes('github'))
          conditions.push('ciFailing')
      }
      return [...new Set(conditions)]
    },
    compare: compareReports,
    renderDiff: (diff, to, format, locale, theme) => {
      const parsed = reportDiffSchema.parse(diff)
      const checked = verifyReport(to, redaction)
      if (parsed.to.contentHash !== checked.header.contentHash)
        throw new Error(context.l10n.table.reportUi.generationFailed)
      const notice = reportDiffNotice(parsed, context.l10n.table.reportUi.noChange)
      if (notice !== undefined && (format === 'text' || format === 'md')) return notice
      // The comparison keeps the verified report's own header, needs-you rows
      // and sources; only its sections become the computed diff section.
      const comparison = finalizeReport(
        { ...checked, sections: [reportDiffSection(parsed)] },
        redaction,
      )
      return render[format](comparison, locale, theme)
    },
  }
}

/** M115 supplies authority and destinations; collection stays identical to interactive reports. */
export function createReportingGeneration(context: ReportingContext): ReportGenerationPort {
  const services = createReportingServices(context)
  return {
    async generate(options) {
      const generate = services.generate
      if (generate === undefined) throw new Error(context.l10n.table.reportUi.generationFailed)
      const result = await generate(options)
      if (result.status !== 'generated')
        throw new Error(context.l10n.table.reportUi.generationFailed)
      return result.document
    },
  }
}

export function createReportingEngine(
  context: ReportingContext & { readonly workspaceKey: string },
): ReportPanelEngine {
  const services = createReportingServices(context)
  const redaction = {
    ...(context.workspaceRoot !== undefined && { workspaceRoot: context.workspaceRoot }),
    localRoots: [homedir()],
  }
  const theme = reportThemes.light
  return {
    reports: createReportsHost({
      services,
      text: context.l10n.table,
      locale: context.l10n.locale,
      localePort: { textForLocale: () => context.l10n.table },
      redaction,
      theme,
      get keepHistory() {
        return context.keepHistory
      },
      now: () => new Date().toISOString(),
      readSaved: () => Promise.reject(new Error(context.l10n.table.reportUi.generationFailed)),
      writeOut: () => Promise.reject(new Error(context.l10n.table.reportUi.saveFailed)),
      stdout: () => {
        throw new Error(context.l10n.table.reportUi.generationFailed)
      },
      stderr: () => {
        throw new Error(context.l10n.table.reportUi.generationFailed)
      },
      workspaceKey: context.workspaceKey,
      authorize: (key) => Promise.resolve(key === context.workspaceKey),
      open: () => Promise.reject(new Error(context.l10n.table.reportUi.generationFailed)),
    }),
    render: createReportRenderers({ textForLocale: () => context.l10n.table }, redaction),
    verify: (value) => verifyReport(value, redaction),
    scrub: reportScrubber(redaction),
  }
}

/** Captures only HEAD and the five normalized completion fields, on the first named check. */
export function createReportingCheckJournal(
  context: Pick<ReportingContext, 'workspaceRoot' | 'storageRoot' | 'l10n'>,
) {
  setUiText(context.l10n.table, context.l10n.locale)
  const root = context.workspaceRoot
  if (root === undefined) throw new Error(context.l10n.table.reportUi.generationFailed)
  const workspaceKey = reportWorkspaceKey(root, process.platform)
  const journal = new CheckRunJournal({
    storage: new ReportStorage(context.storageRoot),
    scrub: reportScrubber({ workspaceRoot: root, localRoots: [homedir()] }),
  })
  return {
    /** HEAD at the check's start; the caller's signal (the turn's Stop) is its only end. */
    async commit(signal: AbortSignal): Promise<string> {
      const result = await reportGitIo(root, process.platform, process.env).run(
        ['rev-parse', '--verify', 'HEAD'],
        signal,
      )
      if (result.code !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.stdout.trim()))
        throw new Error(context.l10n.table.reportUi.generationFailed)
      return result.stdout.trim()
    },
    append: (record: CheckRunRecord) => journal.append(workspaceKey, record),
  }
}
