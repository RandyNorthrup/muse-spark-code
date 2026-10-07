import reportThemes from '../../../design/tokens/generated/report-themes.json'
import type { UiText } from '../../shared/l10n/en'
import { EN } from '../../shared/l10n/en'
import { tableProblems } from '../../shared/l10n/check'
import { tableLocaleFor } from '../../shared/l10n/locales'
import { REPORT_EXIT_CODES, REPORT_KINDS } from '../../shared/constants'
import type { AcpReportsPort } from '../../acp/reports'
import { parseReportsArguments, reportArguments, reportsUsage } from './reportsArgs'
import { runReportsCommand, type ReportsCommandDeps, type ReportsServices } from './reportsCommand'

export { createReportsHost } from './reportsHost'
export {
  createReportingServices,
  createReportingEngine,
  createReportingGeneration,
  createReportingCheckJournal,
} from './engine'

export interface RuntimeReportsInput {
  readonly cwd: string
  readonly locale: string
  readonly table: UiText
  readonly now: () => string
  readonly readSaved: (cwd: string, file: string) => Promise<unknown>
  /** The IO adapter resolves the real path before any bytes are read. */
  readonly resolveSaved: (cwd: string, file: string) => Promise<string>
  readonly writeOut: (cwd: string, file: string, text: string) => Promise<void>
  readonly readTable: (locale: string) => Promise<unknown>
  readonly stdout: (text: string) => void
  readonly stderr: (text: string) => void
  /** M113 S/K/H + M104 B bind a workspace/session and its settings here. */
  readonly servicesFor?:
    | ((
        cwd: string,
        sessionId?: string,
        language?: { readonly table: UiText; readonly locale: string },
      ) => Promise<{
        readonly services: ReportsServices
        readonly keepHistory: boolean
      }>)
    | undefined
  readonly roots: readonly string[]
}

function isTable(value: unknown, locale: string): value is UiText {
  return tableProblems(EN, value, { locale, isStrict: false }).length === 0
}

/** Loaded as dist/reporting.js on the first report, including ACP commands. */
export function createRuntimeReports(input: RuntimeReportsInput) {
  const UI_TEXT = input.table
  async function run(
    argv: readonly string[],
    cwd: string,
    sessionId: string | undefined,
    stdout: (text: string) => void,
    stderr: (text: string) => void,
    signal?: AbortSignal,
  ) {
    let request
    try {
      request = parseReportsArguments(argv)
    } catch {
      // The command owns usage/help handling, with no source or history access.
    }
    const locale = request?.locale ?? input.locale
    let table = input.table
    if (locale !== input.locale) {
      const tableLocale = tableLocaleFor(locale)
      if (tableLocale === undefined) table = EN
      else {
        try {
          const value = await input.readTable(tableLocale)
          if (!isTable(value, tableLocale)) throw new Error(UI_TEXT.reportUi.generationFailed)
          table = value
        } catch {
          stderr(UI_TEXT.reportUi.generationFailed)
          return REPORT_EXIT_CODES.failed
        }
      }
    }
    let binding
    try {
      binding =
        request === undefined ||
        (request.from !== undefined &&
          !request.save &&
          request.diff === undefined &&
          request.options.failOn.length === 0)
          ? undefined
          : await input.servicesFor?.(cwd, sessionId, { table, locale })
    } catch {
      stderr(table.reportUi.generationFailed)
      return REPORT_EXIT_CODES.failed
    }
    const deps: ReportsCommandDeps = {
      text: table,
      services: binding?.services ?? {},
      keepHistory: binding?.keepHistory ?? true,
      locale,
      localePort: { textForLocale: () => table },
      theme: reportThemes.light,
      now: input.now,
      redaction: { workspaceRoot: cwd, localRoots: input.roots },
      readSaved: async (file) => {
        // Normalize before matching: saved imports never read credentials on any OS.
        const resolved = await input.resolveSaved(cwd, file)
        if (
          [file, resolved].some((name) =>
            name
              .replaceAll('\\', '/')
              .toLowerCase()
              .split('/')
              .some((part) =>
                /^(?:\.env(?:\..*)?|\.?credentials(?:\..*)?|auth\.json|id_(?:rsa|ed25519)|.*\.(?:pem|key|p12|pfx))$/.test(
                  part,
                ),
              ),
          )
        )
          throw new Error(UI_TEXT.reportUi.generationFailed)
        return await input.readSaved(cwd, resolved)
      },
      writeOut: (file, text) => input.writeOut(cwd, file, text),
      stdout,
      stderr,
      ...(signal !== undefined && { signal }),
    }
    return await runReportsCommand(argv, deps)
  }
  const acp: AcpReportsPort = {
    format: 'md',
    async execute(args, context) {
      let text = ''
      const capture = (part: string) => {
        text += part
      }
      try {
        context.signal.throwIfAborted()
        if (args === '')
          return {
            code: REPORT_EXIT_CODES.generated,
            text: `${UI_TEXT.reportUi.title}\n${REPORT_KINDS.map((kind) => `/report ${kind}: ${UI_TEXT.reportKinds[kind]}`).join('\n')}\n/report history\n`,
          }
        let argv
        let request
        try {
          argv = reportArguments(args)
          if (argv.includes('--help') || argv.includes('-h'))
            return { code: REPORT_EXIT_CODES.generated, text: reportsUsage(UI_TEXT) }
          request = parseReportsArguments(argv)
        } catch {
          return { code: REPORT_EXIT_CODES.usage, text: reportsUsage(UI_TEXT) }
        }
        const format = request.formatExplicit ? request.format : context.format
        // Refuse unsupported formats before any source/history access or paid/model dispatch.
        if (
          request.out !== undefined ||
          (format !== 'text' && format !== 'md') ||
          (format !== 'text' && context.format === 'text')
        )
          return {
            code: REPORT_EXIT_CODES.usage,
            text: reportsUsage(UI_TEXT),
          }
        if (
          request.kind === 'session' &&
          request.from === undefined &&
          request.options.sessionId === undefined
        )
          argv.push('--session', context.sessionId)
        const code = await run(
          [...argv, '--format', format],
          context.cwd,
          context.sessionId,
          capture,
          capture,
          context.signal,
        )
        return { code, text }
      } catch {
        return { code: REPORT_EXIT_CODES.failed, text: UI_TEXT.reportUi.generationFailed }
      }
    },
  }
  return {
    run: (argv: readonly string[]) => run(argv, input.cwd, undefined, input.stdout, input.stderr),
    acp,
  }
}
