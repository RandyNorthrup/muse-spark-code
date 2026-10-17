// Shared surface: native hosts and the companion page mount the same component.
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import {
  PLAYBOOK_CONFIGURABLE_RULES,
  PLAYBOOK_PATCH_ROUNDS_MAX,
  REVIEW_FINDING_TEXT_MAX_CHARS,
  UI_TEXT,
} from '../../shared/constants'
import { formatNumber } from '../../shared/l10n/text'
import type { PlaybookConfigurableRule, PlaybookSettings } from '../../shared/playbook'
import {
  playbookChangeSchema,
  playbookSnapshotSchema,
  type PlaybookChange,
  type PlaybookSnapshot,
  type PlaybookSurfacePort,
} from '../../runtime/playbook/command'
import { disabledPlaybookDetail, playbookText } from '../../runtime/playbook/text'

function RuleSetting({
  id,
  rule,
  setting,
  busy,
  save,
}: {
  readonly id: string
  readonly rule: PlaybookConfigurableRule
  readonly setting: PlaybookSettings['rules']['threeStrikes']
  readonly busy: boolean
  readonly save: (change: PlaybookChange, form: HTMLFormElement) => Promise<void>
}) {
  const [enabled, setEnabled] = useState(setting.enabled)
  const [reason, setReason] = useState(setting.enabled ? '' : setting.reason)
  const [error, setError] = useState(false)
  const detail = disabledPlaybookDetail(setting)
  const isUnchanged =
    enabled === setting.enabled &&
    (enabled || reason.trim() === (setting.enabled ? '' : setting.reason))
  return (
    <form
      className="playbook-rule"
      aria-labelledby={`${id}-heading`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        if (busy || isUnchanged) return
        const parsed = playbookChangeSchema.safeParse(
          enabled ? { rule, enabled } : { rule, enabled, reason },
        )
        setError(!parsed.success)
        if (parsed.success) void save(parsed.data, event.currentTarget)
      }}
    >
      <h3 id={`${id}-heading`} tabIndex={-1}>
        <label className="playbook-switch">
          <input
            id={`${id}-toggle`}
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => {
              setEnabled(event.target.checked)
              setError(false)
            }}
          />
          <span>{UI_TEXT.playbookRules[rule]}</span>
          <span>{enabled ? UI_TEXT.playbookEnabled : UI_TEXT.playbookDisabled}</span>
        </label>
      </h3>
      {detail === undefined ? null : <p className="playbook-detail">{detail}</p>}
      {enabled ? null : (
        <>
          <label htmlFor={id}>{UI_TEXT.playbookReasonLabel}</label>
          <textarea
            id={id}
            required
            maxLength={REVIEW_FINDING_TEXT_MAX_CHARS}
            value={reason}
            disabled={busy}
            aria-invalid={error}
            aria-describedby={error ? `${id}-error` : undefined}
            onChange={(event) => {
              setReason(event.target.value)
              setError(false)
            }}
          />
        </>
      )}
      {error ? (
        <p id={`${id}-error`} role="alert">
          {UI_TEXT.playbookReasonRequired}
        </p>
      ) : null}
      <button
        id={`${id}-save`}
        type="submit"
        className="playbook-button"
        disabled={busy}
        aria-disabled={busy || isUnchanged}
      >
        {UI_TEXT.playbookSave}
      </button>
    </form>
  )
}

function Settings({
  snapshot,
  busy,
  save,
}: {
  readonly snapshot: PlaybookSnapshot
  readonly busy: boolean
  readonly save: (change: PlaybookChange, form: HTMLFormElement) => Promise<void>
}) {
  const id = useId()
  const [limit, setLimit] = useState(snapshot.settings.patchRoundsMax)
  const [savedLimit, setSavedLimit] = useState(snapshot.settings.patchRoundsMax)
  if (savedLimit !== snapshot.settings.patchRoundsMax) {
    setSavedLimit(snapshot.settings.patchRoundsMax)
    setLimit(snapshot.settings.patchRoundsMax)
  }
  return (
    <section aria-label={UI_TEXT.playbookSettings}>
      <h2>
        {UI_TEXT.playbookSettings} ({snapshot.settings.teamId})
      </h2>
      {PLAYBOOK_CONFIGURABLE_RULES.map((rule) => (
        <RuleSetting
          id={`${id}-${rule}`}
          key={`${rule}:${JSON.stringify(snapshot.settings.rules[rule])}`}
          rule={rule}
          setting={snapshot.settings.rules[rule]}
          busy={busy}
          save={save}
        />
      ))}
      <div className="playbook-rule" role="note">
        <strong>{UI_TEXT.playbookRules.neverAround}</strong>
        <p>{UI_TEXT.playbookSafetyAlwaysOn}</p>
      </div>
      <form
        className="playbook-rule"
        aria-labelledby={`${id}-rounds-heading`}
        onSubmit={(event) => {
          event.preventDefault()
          if (!busy && limit !== snapshot.settings.patchRoundsMax)
            void save({ patchRoundsMax: limit }, event.currentTarget)
        }}
      >
        <h3 id={`${id}-rounds-heading`} tabIndex={-1}>
          <label htmlFor={id}>{UI_TEXT.playbookPatchRoundsLabel}</label>
        </h3>
        <p id={`${id}-help`}>{UI_TEXT.playbookPatchRoundsHelp}</p>
        <select
          id={id}
          aria-describedby={`${id}-help`}
          value={limit}
          disabled={busy}
          onChange={(event) => {
            setLimit(Number(event.target.value))
          }}
        >
          {[1, PLAYBOOK_PATCH_ROUNDS_MAX].map((value) => (
            <option key={value} value={value}>
              {formatNumber(value)}
            </option>
          ))}
        </select>
        <button
          id={`${id}-rounds-save`}
          type="submit"
          className="playbook-button"
          disabled={busy}
          aria-disabled={busy || limit === snapshot.settings.patchRoundsMax}
        >
          {UI_TEXT.playbookSave}
        </button>
      </form>
    </section>
  )
}

export interface PlaybookPanelProps {
  readonly port: PlaybookSurfacePort
}

export function PlaybookPanel({ port }: PlaybookPanelProps) {
  const surface = useRef<HTMLElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const [data, setData] = useState<{ port: PlaybookSurfacePort; snapshot: PlaybookSnapshot }>()
  const snapshot = data?.port === port ? data.snapshot : undefined
  const activePort = useRef<PlaybookSurfacePort>(undefined)
  const [view, setView] = useState<'status' | 'record' | 'settings'>('status')
  const [busyPort, setBusy] = useState<PlaybookSurfacePort>()
  const isBusy = busyPort === port
  const [errorPort, setError] = useState<PlaybookSurfacePort>()
  const isError = errorPort === port
  const [saved, setSaved] = useState<{
    port: PlaybookSurfacePort
    controlId: string
    headingId: string | null
  }>()
  useLayoutEffect(() => {
    if (saved?.port !== port) return
    const control = surface.current?.querySelector<HTMLElement>(
      `[id="${CSS.escape(saved.controlId)}"]`,
    )
    const ruleHeading =
      saved.headingId === null
        ? null
        : surface.current?.querySelector<HTMLElement>(`[id="${CSS.escape(saved.headingId)}"]`)
    if (control != null) control.focus()
    else if (ruleHeading == null) heading.current?.focus()
    else ruleHeading.focus()
  }, [saved, port])
  useEffect(() => {
    let isActive = true
    activePort.current = port
    heading.current?.focus()
    const read = async () => {
      try {
        const next = playbookSnapshotSchema.parse(await port.read())
        if (isActive) {
          setData({ port, snapshot: next })
          setError(undefined)
        }
      } catch {
        if (isActive) setError(port)
      }
    }
    void read()
    return () => {
      isActive = false
      activePort.current = undefined
    }
  }, [port])
  const save = async (change: PlaybookChange, form: HTMLFormElement) => {
    if (isBusy || snapshot === undefined) return
    const active = form.ownerDocument.activeElement
    const control = active !== null && form.contains(active) ? active : form.querySelector('button')
    const controlId = control?.id ?? ''
    const headingId = form.getAttribute('aria-labelledby')
    setBusy(port)
    setError(undefined)
    setSaved(undefined)
    try {
      const next = playbookSnapshotSchema.parse(
        await port.change(playbookChangeSchema.parse(change)),
      )
      if (next.settings.teamId !== snapshot.settings.teamId)
        throw new Error(UI_TEXT.playbookUnavailable)
      if (activePort.current === port) {
        setData({ port, snapshot: next })
        setSaved({ port, controlId, headingId })
      }
    } catch {
      if (activePort.current === port) setError(port)
    } finally {
      if (activePort.current === port) setBusy(undefined)
    }
  }
  const labels = {
    status: UI_TEXT.playbookStatus,
    record: UI_TEXT.playbookRecord,
    settings: UI_TEXT.playbookSettings,
  }
  let content
  if (snapshot === undefined)
    content = isError ? null : <p role="status">{UI_TEXT.loadingOutput}</p>
  else if (view === 'settings')
    content = (
      <Settings key={snapshot.settings.teamId} snapshot={snapshot} busy={isBusy} save={save} />
    )
  else
    content = (
      <pre className="playbook-record" tabIndex={0}>
        {playbookText(view, snapshot)}
      </pre>
    )
  return (
    <section ref={surface} className="playbook-surface" aria-label={UI_TEXT.playbookTitle}>
      {isError ? <p role="alert">{UI_TEXT.playbookUnavailable}</p> : null}
      <p role="status" aria-live="polite" aria-atomic="true">
        {saved?.port === port ? UI_TEXT.playbookSaved : ''}
      </p>
      <h1 ref={heading} tabIndex={-1}>
        {UI_TEXT.playbookTitle}
      </h1>
      <div className="playbook-views" aria-label={UI_TEXT.playbookTitle}>
        {(['status', 'record', 'settings'] as const).map((value) => (
          <button
            type="button"
            className="playbook-button"
            key={value}
            aria-pressed={view === value}
            onClick={() => {
              setView(value)
            }}
          >
            {labels[value]}
          </button>
        ))}
      </div>
      {content}
    </section>
  )
}
