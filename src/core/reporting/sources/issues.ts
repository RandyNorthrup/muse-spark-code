// The issue watchdog's records (M115w) as the reporting `issues` source:
// each watched issue's stage, verdict, fixing pull request and what it
// waits for, owner-blocked first, and each repository's own approval and
// close settings. Reads only through the injected reader; only the issues
// kind binds it.
import * as z from 'zod/mini'
import { watchdogRepoDataSchema, type WatchdogState } from '../../../shared/watchdog'
import { issuesSections, type IssuesIssueView, type IssuesPolicyView } from '../collect/issues'
import { localSource, LocalSourceError, scrubSourceValue, type SourceScrub } from './local'
import type { SourceReadContext } from './types'

/** The watchdog's repository records; no watched repository is an empty report. */
export interface IssuesReportReader {
  read(context: SourceReadContext): Promise<{
    repositories: readonly unknown[]
    observedAt: string
    partial?: string
  }>
}

/** What waits on the person (a decision, a verification) comes first, then
what waits on the watchdog's next step, then the reporter, then the rest. */
const STAGE_RANK: Readonly<Record<WatchdogState, number>> = {
  triaged: 0,
  planned: 0,
  seen: 1,
  acknowledged: 1,
  awaitingInfo: 2,
  replied: 3,
  closed: 4,
}

export function issuesSource(reader: IssuesReportReader | undefined, scrub: SourceScrub) {
  return localSource('issues', async (context) => {
    if (context.options.kind !== 'issues') throw new LocalSourceError('disabled')
    if (reader === undefined) throw new LocalSourceError('unbound')
    const text = context.reportText
    const read = await reader.read(context)
    const issues: IssuesIssueView[] = []
    const policies: IssuesPolicyView[] = []
    let partial = read.partial
    try {
      const repositories = z
        .array(watchdogRepoDataSchema)
        .parse(scrubSourceValue(read.repositories, scrub))
      const wanted = context.options.scope
      const shown = repositories.filter(
        (data) => wanted === '' || data.policy.repository === wanted,
      )
      // A named repository nobody watches is said, not shown as empty.
      if (wanted !== '' && shown.length === 0) partial = scrub(text.watchdog.cli.notWatched)
      for (const [repositoryIndex, data] of shown.entries()) {
        policies.push({
          repository: data.policy.repository,
          settings: [
            { name: 'posts', value: data.policy.postsBeyondAck },
            { name: 'close', value: data.policy.closePolicy },
            ...(data.policy.paused
              ? [{ name: 'paused', value: text.watchdog.cli.pausedWord }]
              : []),
          ],
        })
        for (const record of data.issues) {
          issues.push({
            repository: data.policy.repository,
            number: record.issueNumber,
            title: record.lastTitle,
            rank: STAGE_RANK[record.state],
            repositoryIndex,
            stageText: text.watchdog.states[record.state],
            verdictText:
              record.findings === undefined ? '' : text.watchdog.verdicts[record.findings.verdict],
            waitsText: text.watchdog.waits[record.state],
            pullRequestNumber: record.pullRequestNumber,
          })
        }
      }
    } catch {
      throw new LocalSourceError('invalid')
    }
    return {
      data: issuesSections({ issues, policies }, context.options),
      observedAt: read.observedAt,
      ...(partial !== undefined && { partial }),
    }
  })
}
