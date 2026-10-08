import { useState, type ReactNode } from 'react'
import {
  MILLISECONDS_PER_DAY,
  SCHEDULE_DELIVERIES,
  SCHEDULE_LIFETIME_MS,
  SCHEDULE_MODES,
  UI_TEXT,
} from '../../shared/constants'
import { fill, plural } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import {
  scheduleDraftSchema,
  scheduleTargetSchema,
  scheduleResponseSchema,
  type ScheduleDraft,
  type ScheduleRequest,
} from '../../shared/scheduleV2'
import { CapabilityOptions } from './CapabilityOptions'
import { GrantFields } from './GrantFields'
import {
  schedulePreviewSchema,
  type EventSources,
  type ScheduleSurfaceProps,
  type ScheduleView,
} from './ports'
import { scheduleDateTime } from './presentation'
import { TriggerFields, UtcInput } from './TriggerFields'

export function draftOf(schedule: ScheduleView): ScheduleDraft {
  return scheduleDraftSchema.parse({
    name: schedule.name,
    action: schedule.action,
    trigger: schedule.trigger,
    target: schedule.target,
    delivery: schedule.delivery,
    whenClosed: schedule.whenClosed,
    catchUp: schedule.catchUp,
    mode: schedule.mode,
    grant: schedule.grant,
    paidCapUsd: schedule.paidCapUsd,
    parallel: schedule.parallel,
    zone: schedule.zone,
    end: schedule.end,
    pinned: schedule.pinned,
  })
}

export function ScheduleEditor({
  context,
  schedule,
  sources,
  busy,
  onSave,
  onClose,
}: {
  readonly context: ScheduleSurfaceProps
  readonly schedule: ScheduleView | undefined
  readonly sources: EventSources
  readonly busy: boolean
  readonly onSave: (request: ScheduleRequest) => void
  readonly onClose: () => void
}) {
  const [draft, setDraft] = useState(() =>
    schedule === undefined ? context.defaultDraft : draftOf(schedule),
  )
  const [validConditions, setValidConditions] = useState(true)
  const [conditionText, setConditionText] = useState('')
  const [error, setError] = useState<string>()
  const [preview, setPreview] = useState<{
    draft: ScheduleDraft
    conditions: string
    text: string | undefined
    times?: readonly number[] | undefined
  }>()
  const targetId =
    context.targets.find(
      (item) =>
        JSON.stringify(scheduleTargetSchema.parse(item.target)) ===
        JSON.stringify(scheduleTargetSchema.parse(draft.target)),
    )?.id ?? ''
  let event: Extract<ScheduleDraft['trigger'], { kind: 'event' }> | undefined
  if (draft.trigger.kind === 'afterEvent') event = draft.trigger.event
  else if (draft.trigger.kind === 'event') event = draft.trigger
  const eventSource =
    event === undefined ? undefined : sources.find((item) => item.id === event.source)
  const isAvailable =
    (draft.action.kind !== 'report' || context.reportAction?.capability.available === true) &&
    context.targets.some((item) => item.capability.available && item.id === targetId) &&
    (event === undefined ||
      (eventSource?.capability.available === true && eventSource.kinds.includes(event.event)))
  const validate = (): ScheduleDraft | undefined => {
    const parsed = scheduleDraftSchema.safeParse(draft)
    if (!validConditions || !isAvailable || !parsed.success) {
      setError(UI_TEXT.scheduleV2.editor.invalid)
      return undefined
    }
    setError(undefined)
    return parsed.data
  }
  const showPreview = async () => {
    const valid = validate()
    if (valid === undefined) return
    try {
      let historyText: string | undefined
      if (event !== undefined) {
        const range = {
          fromMs: Math.max(0, context.nowMs - SCHEDULE_LIFETIME_MS),
          toMs: context.nowMs,
        }
        const response = scheduleResponseSchema.parse(
          await context.port.request({
            method: 'schedules/historyPreview',
            workspaceKey: context.workspaceKey,
            trigger: event,
            range,
          }),
        )
        if (
          response.kind !== 'historyPreview' ||
          JSON.stringify(response.trigger) !== JSON.stringify(event) ||
          response.range.fromMs !== range.fromMs ||
          response.range.toMs !== range.toMs
        )
          throw new Error(UI_TEXT.scheduleV2.editor.loadFailed)
        historyText = response.preview.available
          ? plural(UI_TEXT.scheduleV2.historyPreview, response.preview.matchedCount, {
              days: (range.toMs - range.fromMs) / MILLISECONDS_PER_DAY,
            })
          : `${UI_TEXT.scheduleV2.messages.historyUnavailable} ${response.preview.reason}`
      }
      if (draft.trigger.kind === 'event')
        setPreview({ draft, conditions: conditionText, text: historyText })
      else {
        const response = schedulePreviewSchema.parse(await context.port.preview(valid))
        setPreview({
          draft,
          conditions: conditionText,
          ...(response.available
            ? { text: historyText, times: response.times }
            : { text: response.reason }),
        })
      }
    } catch {
      setPreview({ draft, conditions: conditionText, text: UI_TEXT.scheduleV2.editor.loadFailed })
    }
  }
  let actionEditor: ReactNode
  if (draft.action.kind === 'prompt')
    actionEditor = (
      <label>
        {UI_TEXT.scheduleV2.labels.prompt}
        <textarea
          required
          value={draft.action.prompt}
          onChange={(event) => {
            setDraft({ ...draft, action: { kind: 'prompt', prompt: event.target.value } })
          }}
        />
      </label>
    )
  else if (context.reportAction?.capability.available === true)
    actionEditor = context.reportAction.render(draft.action, (action) => {
      setDraft({
        ...draft,
        action,
        paidCapUsd: 0,
        grant: {
          ...draft.grant,
          paidCapUsd: 0,
          destinationIds: action.destinations.map((item) => item.id),
        },
      })
    })
  else
    actionEditor = (
      <p>
        {UI_TEXT.scheduleV2.labels.report}: {UI_TEXT.scheduleV2.labels.unavailable}
        {context.reportAction?.capability.available === false
          ? `: ${context.reportAction.capability.reason}`
          : ''}
      </p>
    )
  return (
    <section aria-label={UI_TEXT.scheduleV2.editor.edit}>
      <h2>{UI_TEXT.scheduleV2.editor.edit}</h2>
      <form
        className="schedule-v2-editor"
        onSubmit={(event) => {
          event.preventDefault()
          const valid = validate()
          if (valid !== undefined)
            onSave(
              schedule === undefined
                ? { method: 'schedules/create', workspaceKey: context.workspaceKey, draft: valid }
                : {
                    method: 'schedules/update',
                    workspaceKey: context.workspaceKey,
                    id: schedule.id,
                    revision: schedule.revision,
                    draft: valid,
                  },
            )
        }}
      >
        <label>
          {UI_TEXT.scheduleV2.labels.name}
          <input
            required
            value={draft.name}
            onChange={(event) => {
              setDraft({ ...draft, name: event.target.value })
            }}
          />
        </label>
        <label>
          {UI_TEXT.scheduleV2.labels.action}
          <select
            value={draft.action.kind}
            onChange={(event) => {
              if (event.target.value === 'prompt') {
                setDraft({
                  ...draft,
                  action:
                    context.defaultDraft.action.kind === 'prompt'
                      ? context.defaultDraft.action
                      : { kind: 'prompt', prompt: '' },
                })
              } else if (context.reportAction?.capability.available === true) {
                const action = context.reportAction.initial
                setDraft({
                  ...draft,
                  action,
                  paidCapUsd: 0,
                  grant: {
                    ...draft.grant,
                    paidCapUsd: 0,
                    destinationIds: action.destinations.map((item) => item.id),
                  },
                })
              }
            }}
          >
            <option value="prompt">{UI_TEXT.scheduleV2.labels.prompt}</option>
            <option value="report" disabled={context.reportAction?.capability.available !== true}>
              {UI_TEXT.scheduleV2.labels.report}
              {context.reportAction?.capability.available === true
                ? ''
                : `: ${UI_TEXT.scheduleV2.labels.unavailable}`}
            </option>
          </select>
        </label>
        {actionEditor}
        <TriggerFields
          trigger={draft.trigger}
          nowMs={context.nowMs}
          zone={draft.zone}
          sources={sources}
          onChange={(trigger) => {
            setDraft({ ...draft, trigger })
          }}
          onValid={(isValid, text = '') => {
            setValidConditions(isValid)
            setConditionText(text)
            setPreview(undefined)
          }}
        />
        <label>
          {UI_TEXT.scheduleV2.labels.timeZone}
          <input
            required
            value={draft.zone}
            onChange={(event) => {
              setDraft({ ...draft, zone: event.target.value })
            }}
          />
        </label>
        <fieldset>
          <legend>{UI_TEXT.scheduleV2.labels.end}</legend>
          <UtcInput
            label={UI_TEXT.scheduleV2.editor.endDate}
            value={draft.end?.atMs}
            onChange={(atMs) => {
              const end = { ...draft.end, atMs }
              setDraft({
                ...draft,
                end: end.atMs === undefined && end.afterRuns === undefined ? undefined : end,
              })
            }}
          />
          <label>
            {UI_TEXT.scheduleV2.editor.afterRuns}
            <input
              type="number"
              min={1}
              value={draft.end?.afterRuns ?? ''}
              onChange={(event) => {
                const end = {
                  ...draft.end,
                  afterRuns: event.target.value === '' ? undefined : event.target.valueAsNumber,
                }
                setDraft({
                  ...draft,
                  end: end.atMs === undefined && end.afterRuns === undefined ? undefined : end,
                })
              }}
            />
          </label>
        </fieldset>
        <label>
          {UI_TEXT.scheduleV2.labels.target}
          <select
            value={targetId}
            onChange={(event) => {
              const choice = context.targets.find((item) => item.id === event.target.value)
              if (choice?.capability.available === true)
                setDraft({
                  ...draft,
                  target: choice.target,
                  ...(choice.target.kind === 'newConversation' && { delivery: 'newConversation' }),
                })
            }}
          >
            <option value="" disabled>
              {UI_TEXT.scheduleV2.labels.unavailable}
            </option>
            <CapabilityOptions items={context.targets} />
          </select>
        </label>
        <label>
          {UI_TEXT.scheduleV2.labels.delivery}
          <select
            value={draft.delivery}
            onChange={(event) => {
              const parsed = scheduleDraftSchema.safeParse({
                ...draft,
                delivery: event.target.value,
                parallel: event.target.value === 'newConversation' && draft.parallel,
              })
              if (parsed.success) setDraft(parsed.data)
            }}
          >
            {SCHEDULE_DELIVERIES.map((kind) => (
              <option
                key={kind}
                value={kind}
                disabled={draft.target.kind === 'newConversation' && kind !== 'newConversation'}
              >
                {UI_TEXT.scheduleV2.delivery[kind]}
              </option>
            ))}
          </select>
        </label>
        {draft.delivery === 'interrupt' ? (
          <p>{UI_TEXT.scheduleV2.messages.interruptWarning}</p>
        ) : null}
        <label>
          {UI_TEXT.scheduleV2.labels.mode}
          <select
            value={draft.mode}
            onChange={(event) => {
              const mode = SCHEDULE_MODES.find((item) => item === event.target.value)
              if (mode !== undefined) setDraft({ ...draft, mode })
            }}
          >
            {SCHEDULE_MODES.map((mode) => (
              <option key={mode} value={mode}>
                {UI_TEXT.permissionModes[mode]}
              </option>
            ))}
          </select>
        </label>
        <GrantFields
          grant={draft.grant}
          onChange={(grant) => {
            setDraft({ ...draft, grant })
          }}
        />
        {draft.action.kind === 'report' ? null : (
          <label>
            {UI_TEXT.scheduleV2.labels.paidCap}
            <input
              type="number"
              min={0}
              step="any"
              value={Number.isFinite(draft.paidCapUsd) ? draft.paidCapUsd : ''}
              onChange={(event) => {
                const paidCapUsd = event.target.valueAsNumber
                setDraft({ ...draft, paidCapUsd, grant: { ...draft.grant, paidCapUsd } })
              }}
            />
          </label>
        )}
        <label>
          <input
            type="checkbox"
            disabled={draft.delivery !== 'newConversation'}
            checked={draft.parallel}
            onChange={(event) => {
              setDraft({ ...draft, parallel: event.target.checked })
            }}
          />
          {UI_TEXT.scheduleV2.labels.parallel}
        </label>
        <label>
          <input
            type="checkbox"
            checked={draft.pinned}
            onChange={(event) => {
              setDraft({ ...draft, pinned: event.target.checked })
            }}
          />
          {UI_TEXT.scheduleV2.labels.pin}
        </label>
        <label>
          {UI_TEXT.scheduleV2.labels.whenClosed}
          <select
            value={draft.whenClosed}
            onChange={(event) => {
              setDraft({ ...draft, whenClosed: event.target.value === 'skip' ? 'skip' : 'open' })
            }}
          >
            <option value="open">{UI_TEXT.scheduleV2.policies.open}</option>
            <option value="skip">{UI_TEXT.scheduleV2.policies.skip}</option>
          </select>
        </label>
        <label>
          {UI_TEXT.scheduleV2.labels.catchUp}
          <select
            value={draft.catchUp}
            onChange={(event) => {
              setDraft({ ...draft, catchUp: event.target.value === 'skip' ? 'skip' : 'runOnce' })
            }}
          >
            <option value="runOnce">{UI_TEXT.scheduleV2.policies.runOnce}</option>
            <option value="skip">{UI_TEXT.scheduleV2.policies.skip}</option>
          </select>
        </label>
        {context.paid === undefined || draft.action.kind === 'report' ? null : (
          <p>
            {fill(UI_TEXT.scheduleV2.messages.paidConsent, {
              prompt: draft.action.prompt,
              model: context.paid.model,
              price: context.paid.price,
              cadence: UI_TEXT.scheduleV2.triggers[draft.trigger.kind],
              cap: formatUsd(draft.paidCapUsd, 2),
              budget: formatUsd(context.paid.sharedDailyBudgetUsd, 2),
            })}
          </p>
        )}
        <p>{UI_TEXT.scheduleV2.messages.deferredQuestions}</p>
        {error === undefined ? null : <p role="alert">{error}</p>}
        <div className="schedule-v2-actions">
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              void showPreview()
            }}
          >
            {UI_TEXT.scheduleV2.labels.preview}
          </button>
          <button type="submit" disabled={busy}>
            {UI_TEXT.scheduleV2.labels.save}
          </button>
          <button type="button" onClick={onClose}>
            {UI_TEXT.goalEditCancel}
          </button>
        </div>
        {validConditions && preview?.draft === draft && preview.conditions === conditionText ? (
          <div role="status">
            {preview.text}
            <ol>
              {preview.times?.map((atMs) => (
                <li key={atMs}>
                  {scheduleDateTime(atMs, draft.zone)} · {draft.zone}
                </li>
              ))}
            </ol>
          </div>
        ) : null}
      </form>
    </section>
  )
}
