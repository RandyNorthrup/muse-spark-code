import { accountsSource, type ReportAccountsReader } from './accounts'
import { agentUsageSource, type AgentUsageAgent, type AgentUsageFiles } from './agentUsage'
import { joinPartialReasons } from './boundary'
import { certificationSource } from './certification'
import { changelogSource } from './changelog'
import { gitSource, type ReportGitIo } from './git'
import { localSource, LocalSourceError, type LocalFileIo, type SourceScrub } from './local'
import { packageSource } from './package'
import { questionsSource, type ReportQuestionsReader } from './questions'
import { securitySource, type ReportSecurityReader } from './security'
import { scrubUsage, sessionSource, type ReportSessionReader } from './session'
import type { ReportSourcePorts, SourceReadContext, UsageFacts } from './types'

export interface LocalReportSourceDeps {
  readonly files: LocalFileIo
  readonly git: ReportGitIo
  readonly scrub: SourceScrub
  readonly roots: readonly string[]
  readonly session?: ReportSessionReader
  readonly questions?: ReportQuestionsReader
  /** M102's aggregate adapter, supplied by its owner; no journal parser is guessed. */
  readonly usage?: (context: SourceReadContext) => Promise<{
    usage: UsageFacts
    observedAt: string
    /** Breakdowns the journal cannot attribute stay partial, never invented. */
    partial?: string
  }>
  /** M108's registry adapter, supplied by its owner; credentials never enter. */
  readonly accounts?: ReportAccountsReader
  /** M109's vault audit and the developer audit, supplied by their owners. */
  readonly security?: ReportSecurityReader
  readonly enabledAgents: readonly AgentUsageAgent[]
  readonly agentFiles: AgentUsageFiles
}
export type LocalReportSources = Pick<
  ReportSourcePorts,
  | 'git'
  | 'changelog'
  | 'certification'
  | 'package'
  | 'session'
  | 'questions'
  | 'usage'
  | 'agentUsage'
  | 'accounts'
  | 'security'
>
/** All editors, CLI and ACP bind the same readers in the lazy reporting bundle. */
export function createLocalReportSources(deps: LocalReportSourceDeps): LocalReportSources {
  return {
    git: gitSource(deps.git, deps.scrub, deps.roots),
    changelog: changelogSource(deps.files, deps.scrub),
    certification: certificationSource(deps.files, deps.scrub),
    package: packageSource(deps.files, deps.scrub),
    session: sessionSource(
      deps.session === undefined
        ? undefined
        : {
            read: (context) => {
              if (context.options.kind !== 'session') throw new LocalSourceError('disabled')
              return deps.session?.read(context) ?? Promise.resolve(null)
            },
          },
      deps.roots,
      deps.scrub,
    ),
    questions: questionsSource(deps.questions, deps.scrub),
    usage: localSource('usage', async (context) => {
      if (!['usage', 'project'].includes(context.options.kind))
        throw new LocalSourceError('disabled')
      if (deps.usage === undefined) throw new LocalSourceError('unbound')
      const result = await deps.usage(context)
      const scrubbed = scrubUsage(context.reportText, result.usage, deps.scrub)
      const partial = joinPartialReasons(context.reportText, [
        result.partial === undefined ? undefined : deps.scrub(result.partial),
        ...scrubbed.problems.map((problem) => problem.reason),
      ])
      return {
        data: scrubbed.usage,
        observedAt: result.observedAt,
        ...(partial !== undefined && { partial }),
      }
    }),
    agentUsage: agentUsageSource(deps.enabledAgents, deps.agentFiles, deps.scrub),
    accounts: accountsSource(deps.accounts, deps.scrub),
    security: securitySource(deps.security, deps.scrub),
  }
}
