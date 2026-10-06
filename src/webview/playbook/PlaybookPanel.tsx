// Shared surface: native hosts and the companion page mount the same component.
import { useEffect, useId, useRef, useState } from 'react'
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
  rule,
  setting,
  busy,
  save,
}: {
  readonly rule: PlaybookConfigurableRule
  readonly setting: PlaybookSettings['rules']['threeStrikes']
  readonly busy: boolean
  readonly save: (change: PlaybookChange) => Promise<void>
}) {
  const id = useId()
  const [enabled, setEnabled] = useState(setting.enabled)
  const [reason, setReason] = useState(setting.enabled ? '' : setting.reason)
  const [error, setError] = useState(false)
  const detail = disabledPlaybookDetail(setting)
  return (
    <form
      className="playbook-rule"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        const parsed = playbookChangeSchema.safeParse(
          enabled ? { rule, enabled } : { rule, enabled, reason },
        )
        setError(!parsed.success)
        if (parsed.success) void save(parsed.data)
      }}
    >
      <label className="playbook-switch">
        <input
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
        type="submit"
        className="playbook-button"
        disabled={
          busy ||
          (enabled === setting.enabled &&
            (enabled || reason.trim() === (setting.enabled ? '' : setting.reason)))
        }
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
  readonly save: (change: PlaybookChange) => Promise<void>
}) {
  const id = useId()
  const [limit, setLimit] = useState(snapshot.settings.patchRoundsMax)
  return (
    <section aria-label={UI_TEXT.playbookSettings}>
      <h2>
        {UI_TEXT.playbookSettings} ({snapshot.settings.teamId})
      </h2>
      {PLAYBOOK_CONFIGURABLE_RULES.map((rule) => (
        <RuleSetting
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
        onSubmit={(event) => {
          event.preventDefault()
          void save({ patchRoundsMax: limit })
        }}
      >
        <label htmlFor={id}>{UI_TEXT.playbookPatchRoundsLabel}</label>
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
          type="submit"
          className="playbook-button"
          disabled={busy || limit === snapshot.settings.patchRoundsMax}
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
  const heading = useRef<HTMLHeadingElement>(null)
  const [data, setData] = useState<{ port: PlaybookSurfacePort; snapshot: PlaybookSnapshot }>()
  const snapshot = data?.port === port ? data.snapshot : undefined
  const activePort = useRef<PlaybookSurfacePort>(undefined)
  const [view, setView] = useState<'status' | 'record' | 'settings'>('status')
  const [busyPort, setBusy] = useState<PlaybookSurfacePort>()
  const isBusy = busyPort === port
  const [errorPort, setError] = useState<PlaybookSurfacePort>()
  const isError = errorPort === port
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
  const save = async (change: PlaybookChange) => {
    if (isBusy || snapshot === undefined) return
    setBusy(port)
    setError(undefined)
    try {
      const next = playbookSnapshotSchema.parse(
        await port.change(playbookChangeSchema.parse(change)),
      )
      if (next.settings.teamId !== snapshot.settings.teamId)
        throw new Error(UI_TEXT.playbookUnavailable)
      if (activePort.current === port) setData({ port, snapshot: next })
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
      <Settings
        key={`${snapshot.settings.teamId}:${String(snapshot.settings.patchRoundsMax)}`}
        snapshot={snapshot}
        busy={isBusy}
        save={save}
      />
    )
  else
    content = (
      <pre className="playbook-record" tabIndex={0}>
        {playbookText(view, snapshot)}
      </pre>
    )
  return (
    <section className="playbook-surface" aria-label={UI_TEXT.playbookTitle}>
      {isError ? <p role="alert">{UI_TEXT.playbookUnavailable}</p> : null}
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
