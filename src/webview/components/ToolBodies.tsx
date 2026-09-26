// The bodies of Muse Code's own tools (M43, PLAN.md D36): a memory note, a
// goal, the scheduled prompts, a search's results, a workflow's launch (M47)
// and a picture the tool read or made. Each falls back to the tool's own
// text when its result is not the shape captured live.

import { useEffect, useRef } from 'react'
import { UI_TEXT } from '../../shared/constants'
import {
  fill,
  formatDate,
  formatNumber,
  formatPercent,
  plural,
  templateParts,
} from '../../shared/l10n/text'
import type { DiffRow } from '../diff'
import type { ToolImageState, TranscriptEntry } from '../state/uiState'
import {
  type GoalDetails,
  goalDetails,
  imageRequestOf,
  memoryDetails,
  readableText,
  type ScheduledPrompt,
  scheduledPrompts,
  webResults,
} from '../toolDetails'
import { goalStatusLabel } from '../toolPresentation'
import { workflowLaunch } from '../workflowDetails'
import { ExternalLink } from './ExternalLink'
import { GoalBar, GoalWork } from './GoalParts'
import { Clipped, DiffTable } from './ToolBlocks'

type ToolEntry = Extract<TranscriptEntry, { kind: 'tool' }>

/** An edit of one exact string, as diff rows: the old text removed, the new added. */
function replacementRows(before: string, after: string): readonly DiffRow[] {
  const removed = before.split('\n').map((text, index): DiffRow => ({
    kind: 'remove',
    oldLine: index + 1,
    newLine: undefined,
    text,
  }))
  const added = after
    .split('\n')
    .map((text, index): DiffRow => ({ kind: 'add', oldLine: undefined, newLine: index + 1, text }))
  return [...removed, ...added]
}

export function MemoryBody({ entry }: { readonly entry: ToolEntry }) {
  const details = memoryDetails(entry.tool, entry.args, entry.output)
  let content = null
  if (details.before !== undefined && details.after !== undefined) {
    content = <DiffTable rows={replacementRows(details.before, details.after)} />
  } else if (details.note !== undefined) {
    content = <Clipped text={details.note} className="tool-output" />
  }
  return (
    <div className="tool-detail">
      {details.scope === undefined ? null : (
        <div className="tool-detail-meta">{UI_TEXT.memoryScopes[details.scope]}</div>
      )}
      {content}
    </div>
  )
}

function GoalCard({ goal }: { readonly goal: GoalDetails }) {
  const percent = goal.percentComplete
  return (
    <div className="tool-detail">
      <div className="goal-objective">{goal.objective}</div>
      <div className="tool-detail-meta">
        {goalStatusLabel(goal.status)}
        {percent === undefined
          ? ''
          : ` · ${fill(UI_TEXT.goalPercent, { percent: formatPercent(percent) })}`}
      </div>
      {percent === undefined ? null : <GoalBar percent={percent} />}
      <GoalWork currentWork={goal.currentWork} nextWork={goal.nextWork}>
        {goal.tokensUsed === undefined ? null : (
          <>
            <dt>{UI_TEXT.goalTokens}</dt>
            <dd>
              {goal.tokenBudget === undefined
                ? formatNumber(goal.tokensUsed)
                : fill(UI_TEXT.goalTokensOfBudget, {
                    used: formatNumber(goal.tokensUsed),
                    budget: formatNumber(goal.tokenBudget),
                  })}
            </dd>
          </>
        )}
      </GoalWork>
    </div>
  )
}

export function GoalBody({ entry }: { readonly entry: ToolEntry }) {
  const goal = goalDetails(entry.output)
  if (goal !== undefined) {
    return <GoalCard goal={goal} />
  }
  return entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />
}

function ScheduleItem({ job }: { readonly job: ScheduledPrompt }) {
  const facts = [
    job.cron,
    job.isRecurring ? UI_TEXT.scheduleRepeats : UI_TEXT.scheduleOnce,
    ...(job.nextFireAtMs === undefined
      ? []
      : [fill(UI_TEXT.scheduleNextRun, { date: formatDate(job.nextFireAtMs) })]),
    ...(job.fireCount === undefined || job.fireCount === 0
      ? []
      : [plural(UI_TEXT.scheduleFired, job.fireCount)]),
  ]
  return (
    <li>
      <div className="schedule-prompt">{job.prompt}</div>
      <div className="tool-detail-meta">{facts.join(' · ')}</div>
    </li>
  )
}

export function ScheduleBody({ entry }: { readonly entry: ToolEntry }) {
  const jobs = scheduledPrompts(entry.tool, entry.args, entry.output)
  // A result that is not the captured shape, or a failed call: its own text.
  if (jobs === undefined) {
    return entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />
  }
  if (entry.tool === 'cron_list' && entry.status === 'completed' && jobs.length === 0) {
    return <p className="tool-detail-meta">{UI_TEXT.scheduleNone}</p>
  }
  return (
    <div className="tool-detail">
      {jobs.length === 0 ? null : (
        <ul className="schedule-list">
          {jobs.map((job, index) => (
            <ScheduleItem key={job.id ?? String(index)} job={job} />
          ))}
        </ul>
      )}
      {entry.tool === 'cron_list' || entry.output === '' ? null : (
        <Clipped text={entry.output} className="tool-output" />
      )}
    </div>
  )
}

export function WebBody({
  entry,
  onOpenLink,
  onRefuseLink,
}: {
  readonly entry: ToolEntry
  readonly onOpenLink: (url: string) => void
  readonly onRefuseLink: (() => void) | undefined
}) {
  const results = webResults(entry.output)
  if (results === undefined) {
    return entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />
  }
  if (results.length === 0) {
    return <p className="tool-detail-meta">{UI_TEXT.webNoResults}</p>
  }
  return (
    <ol className="web-results">
      {results.map((result) => (
        <li key={result.url}>
          <ExternalLink
            url={result.url}
            title={result.title}
            onOpenLink={onOpenLink}
            onRefuseLink={onRefuseLink}
          />
          {result.snippet === undefined ? null : (
            <div className="web-snippet">{result.snippet}</div>
          )}
        </li>
      ))}
    </ol>
  )
}

/**
 * An image call (M34, M44): what it asked for, the images an edit started
 * from, and what came of it; the picture itself follows the body.
 */
export function ImageBody({ entry }: { readonly entry: ToolEntry }) {
  const { prompt, sources } = imageRequestOf(entry.args)
  return (
    <div className="tool-detail">
      {prompt === undefined ? null : (
        <blockquote className="approval-prompt" dir="auto">
          {prompt}
        </blockquote>
      )}
      {sources.length === 0 ? null : (
        <div className="tool-detail-meta">
          {templateParts(UI_TEXT.approvalImageSources).map((part, index) =>
            typeof part === 'string' ? part : <code key={String(index)}>{sources.join(', ')}</code>,
          )}
        </div>
      )}
      {entry.output === '' ? null : <Clipped text={entry.output} className="tool-output" />}
    </div>
  )
}

/**
 * The Workflow tool's call (M47): the script the model wrote (or the file a
 * resumed run starts from) and whether Muse Code launched it. The run
 * itself is its own card, which follows the row.
 */
export function WorkflowBody({ entry }: { readonly entry: ToolEntry }) {
  const launch = workflowLaunch(entry.args, entry.output)
  let answer = null
  if (launch.isLaunched) {
    answer = (
      <>
        <p className="tool-detail-meta">{UI_TEXT.workflowLaunched}</p>
        {launch.scriptPath === undefined ? null : (
          <p className="tool-detail-meta workflow-path">
            {fill(UI_TEXT.workflowScriptSaved, { path: launch.scriptPath })}
          </p>
        )}
      </>
    )
  } else if (entry.output !== '') {
    answer = <Clipped text={readableText(entry.output)} className="tool-output" />
  }
  return (
    <div className="tool-detail">
      {launch.script === undefined ? null : (
        <Clipped text={launch.script} className="tool-output" />
      )}
      {launch.resumesFrom === undefined ? null : (
        <p className="tool-detail-meta workflow-path">
          {fill(UI_TEXT.workflowResumesFrom, { path: launch.resumesFrom })}
        </p>
      )}
      {answer}
    </div>
  )
}

/**
 * The picture a tool read or made (M43), asked of the host once the row
 * shows it; it opens in VS Code's image viewer on click.
 */
export function ToolImage({
  path,
  image,
  onRequest,
  onOpen,
}: {
  readonly path: string
  readonly image: ToolImageState | undefined
  readonly onRequest: () => void
  readonly onOpen: () => void
}) {
  // Asked once per row and path: a new callback identity is not a new picture.
  const askedRef = useRef(false)
  useEffect(() => {
    if (image !== undefined || askedRef.current) {
      return
    }
    askedRef.current = true
    onRequest()
  }, [image, onRequest])
  if (image === undefined) {
    return <p className="tool-loading">{UI_TEXT.loadingOutput}</p>
  }
  if (image.kind === 'failed') {
    return (
      <p className="tool-detail-meta">
        {UI_TEXT.toolImageFailed}: {image.reason}
      </p>
    )
  }
  return (
    <button type="button" className="tool-image" title={UI_TEXT.openFileTitle} onClick={onOpen}>
      <img src={image.dataUri} alt={fill(UI_TEXT.toolImageAlt, { path })} />
    </button>
  )
}
