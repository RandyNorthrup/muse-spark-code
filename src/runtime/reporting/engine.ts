import { homedir } from 'node:os'
import {
  UI_TEXT,
  REPORT_EMPTY_HASH,
  REPORT_NEXT_STEP_LIMIT,
  REPORT_FORMAT_VERSION,
  REPORT_PLAN_MAX_BYTES,
  REPORT_SOURCE_TIMEOUT_MS,
} from '../../shared/constants'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import type { ReportDocument, ReportKind } from '../../shared/reportSchema'
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
import type { LocalReportSourceDeps } from '../../core/reporting/sources'
import { readPlan } from '../../core/reporting/plan/reader'
import { createReportCollector } from '../../core/reporting/collect'
import { ReportScopeNotFound } from '../../core/reporting/collect/plan'
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
import { readReportSelections } from './selections'
import { createReportsHost } from './reportsHost'
import type { ReportsServices } from './reportsCommand'
import type { ReportPanelEngine } from '../../shared/reportingEngine'

export interface ReportingContext {
  readonly workspaceRoot: string | undefined
  readonly storageRoot: string
  readonly l10n: { readonly table: UiText; readonly locale: string }
  readonly generatorVersion: string
  readonly keepHistory: boolean
  readonly enabledAgents: LocalReportSourceDeps['enabledAgents']
  readonly session?: LocalReportSourceDeps['session']
  readonly questions?: LocalReportSourceDeps['questions']
  readonly usage?: LocalReportSourceDeps['usage']
  readonly networkSources?: Pick<ReportSourcePorts, 'github' | 'stores'>
}

const unavailable = <K extends ReportSourceKind>(kind: K) =>
  localSource(kind, () => Promise.reject(new LocalSourceError('unbound')))

/** One lazy pipeline for every host. Missing adapters fail as named sources. */
export function createReportingServices(context: ReportingContext): ReportsServices {
  setUiText(context.l10n.table, context.l10n.locale)
  const root = context.workspaceRoot
  const workspaceKey = root === undefined ? undefined : reportWorkspaceKey(root, process.platform)
  const redaction = { ...(root !== undefined && { workspaceRoot: root }), localRoots: [homedir()] }
  const scrub = reportScrubber(redaction)
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
        }).sources
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
        : Promise.reject(new Error(UI_TEXT.reportUi.generationFailed))
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
    if (workspaceKey === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
    return workspaceKey
  }
  return {
    async generate(options, signal = new AbortController().signal) {
      const key = requiredKey()
      const readContext = { options, asOf: options.asOf, workspaceKey: key, signal }
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
        security: unavailable('security'),
        accounts: unavailable('accounts'),
        estimate: unavailable('estimate'),
        playbook: unavailable('playbook'),
        issues: unavailable('issues'),
        schedules: unavailable('schedules'),
        keybindings: unavailable('keybindings'),
        plan: localSource('plan', async ({ signal: planSignal }) => {
          if (root === undefined) throw new LocalSourceError('unbound')
          const text = await reportFileIo(root, process.platform, REPORT_PLAN_MAX_BYTES).read(
            'PLAN.md',
            planSignal,
          )
          return { data: readPlan(scrub(text)).facts }
        }),
      }
      // All reads share the request stamp; source ports bound time and cancellation.
      const [
        plan,
        pkg,
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
      ] = await Promise.all([
        sources.plan.read(readContext),
        sources.package.read(readContext),
        sources.git.read(readContext),
        sources.changelog.read(readContext),
        sources.certification.read(readContext),
        sources.session.read(readContext),
        sources.questions.read(readContext),
        sources.usage.read(readContext),
        sources.agentUsage.read(readContext),
        sources.checkRuns.read(readContext),
        sources.github.read(readContext),
        sources.stores.read(readContext),
        sources.fleet.read(readContext),
        sources.security.read(readContext),
        sources.accounts.read(readContext),
        sources.estimate.read(readContext),
        sources.playbook.read(readContext),
        sources.issues.read(readContext),
        sources.schedules.read(readContext),
        sources.keybindings.read(readContext),
      ])
      signal.throwIfAborted()
      const snapshot: SourceSnapshot = {
        asOf: options.asOf,
        workspaceKey: key,
        generatorVersion: context.generatorVersion,
        rendererVersion: REPORT_FORMAT_VERSION,
        icuVersion: process.versions['icu'] ?? 'unknown',
        locale: context.l10n.locale,
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
            )
      const collector = createReportCollector({
        nextStepLimit: REPORT_NEXT_STEP_LIMIT,
        selections,
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
    compare: compareReports,
    renderDiff: (diff, format, locale, theme) => {
      const notice = reportDiffNotice(diff, context.l10n.table.reportUi.noChange)
      if (notice !== undefined && (format === 'text' || format === 'md')) return notice
      const document = finalizeReport(
        {
          format: REPORT_FORMAT_VERSION,
          header: diff.to,
          sources: [],
          needsYou: {
            id: 'needsYou',
            label: 'needsYou',
            sortKey: 'key',
            columns: [],
            rows: [],
            omittedRows: 0,
          },
          sections: [reportDiffSection(diff)],
          footer: {
            rendererVersion: REPORT_FORMAT_VERSION,
            icuVersion: process.versions['icu'] ?? 'unknown',
            locale,
          },
        },
        redaction,
      )
      return render[format](document, locale, theme)
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
  const theme = {
    background: '#ffffff',
    foreground: '#1f1f1f',
    muted: '#404040',
    border: '#707070',
    accent: '#005fb8',
  }
  return {
    reports: createReportsHost({
      services,
      text: context.l10n.table,
      locale: context.l10n.locale,
      localePort: { textForLocale: () => context.l10n.table },
      redaction,
      theme,
      keepHistory: context.keepHistory,
      now: () => new Date().toISOString(),
      readSaved: () => Promise.reject(new Error(UI_TEXT.reportUi.generationFailed)),
      writeOut: () => Promise.reject(new Error(UI_TEXT.reportUi.saveFailed)),
      stdout: () => {
        throw new Error(UI_TEXT.reportUi.generationFailed)
      },
      stderr: () => {
        throw new Error(UI_TEXT.reportUi.generationFailed)
      },
      workspaceKey: context.workspaceKey,
      authorize: (key) => Promise.resolve(key === context.workspaceKey),
      open: () => Promise.reject(new Error(UI_TEXT.reportUi.generationFailed)),
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
  if (root === undefined) throw new Error(UI_TEXT.reportUi.generationFailed)
  const workspaceKey = reportWorkspaceKey(root, process.platform)
  const journal = new CheckRunJournal({
    storage: new ReportStorage(context.storageRoot),
    scrub: reportScrubber({ workspaceRoot: root, localRoots: [homedir()] }),
  })
  return {
    async commit(): Promise<string> {
      const result = await reportGitIo(root, process.platform, process.env).run(
        ['rev-parse', '--verify', 'HEAD'],
        AbortSignal.timeout(REPORT_SOURCE_TIMEOUT_MS),
      )
      if (result.code !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(result.stdout.trim()))
        throw new Error(UI_TEXT.reportUi.generationFailed)
      return result.stdout.trim()
    },
    append: (record: CheckRunRecord) => journal.append(workspaceKey, record),
  }
}
