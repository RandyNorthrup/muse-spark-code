import { useEffect, useId, useRef, useState } from 'react'
import {
  estimateRequestSchema,
  estimateSectionSchema,
  parseEstimateGoal,
  type CatalogPrice,
  type EstimateRequest,
  type EstimateSection,
} from '../../shared/estimate'
import {
  fill,
  formatDateTime,
  formatNumber,
  formatUnit,
  UI_TEXT,
  uiLocale,
} from '../../shared/l10n/text'
import './estimator.css'

export interface EstimatorPanelPort {
  context(): Pick<EstimateRequest, 'asOf' | 'optimize'>
  estimate(request: EstimateRequest, signal: AbortSignal): Promise<unknown>
  /** Validated refreshed sections from U's view session, bound to M115 by W. */
  subscribe(listener: (section: unknown) => void): () => void
  startExisting?(section: EstimateSection, setup: EstimateSection['setups'][number]): Promise<void>
  price(price: CatalogPrice): string
  readonly provision:
    | { readonly state: 'waiting'; readonly dependency: string }
    | {
        readonly state: 'ready'
        spinUp(section: EstimateSection, setup: EstimateSection['setups'][number]): Promise<void>
      }
}

function setupName(kind: EstimateSection['setups'][number]['kind']): string {
  const names = {
    current: UI_TEXT.estimateCurrent,
    minimumP50: `${UI_TEXT.estimateMinimum} · ${UI_TEXT.estimateP50}`,
    minimumP90: `${UI_TEXT.estimateMinimum} · ${UI_TEXT.estimateP90}`,
    optimumCost: `${UI_TEXT.estimateOptimum} · ${UI_TEXT.estimateCost}`,
    optimumSpeed: `${UI_TEXT.estimateOptimum} · ${UI_TEXT.estimateSpeed}`,
  }
  return names[kind]
}
function resourceName(kind: EstimateSection['limitingResource']['kind']): string {
  return {
    machines: UI_TEXT.estimateMachines,
    slots: UI_TEXT.estimateSlots,
    accountRate: UI_TEXT.estimateAccounts,
    ci: UI_TEXT.estimateCi,
    disk: UI_TEXT.estimateDisk,
    criticalPath: UI_TEXT.estimateCriticalPath,
  }[kind]
}

/** Entry for W's dedicated lazy panel chunk; no host, backend or runtime import. */
export default function EstimatorPanel({
  port,
  initial,
  initialSection,
  isInert = false,
}: {
  readonly port: EstimatorPanelPort
  readonly initial?: EstimateRequest
  readonly initialSection?: EstimateSection | undefined
  readonly isInert?: boolean
}) {
  const id = useId()
  const [goal, setGoal] = useState(initial === undefined ? '' : goalText(initial))
  const [deadline, setDeadline] = useState(initial?.deadline ?? '')
  const [fleet, setFleet] = useState<EstimateRequest['fleet']>(initial?.fleet ?? 'current')
  const [optimize, setOptimize] = useState<EstimateRequest['optimize']>(
    () => initial?.optimize ?? port.context().optimize,
  )
  const [section, setSection] = useState<EstimateSection | undefined>(() =>
    initialSection === undefined ? undefined : estimateSectionSchema.parse(initialSection),
  )
  const [selected, setSelected] = useState<EstimateSection['setups'][number]['kind']>('current')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [spinning, setSpinning] = useState(false)
  const active = useRef<EstimateRequest | undefined>(initialSection?.inputs.request)
  const pending = useRef<AbortController | undefined>(undefined)
  const spinCycle = useRef(0)
  const latestAsOf = useRef(initialSection?.asOf ?? '')

  const [received, setReceived] = useState(initialSection)
  if (received !== initialSection) {
    setReceived(initialSection)
    if (initialSection !== undefined) {
      const next = estimateSectionSchema.parse(initialSection)
      setSection(next)
      setGoal(goalText(next.inputs.request))
      setDeadline(next.inputs.request.deadline ?? '')
      setFleet(next.inputs.request.fleet)
      setOptimize(next.inputs.request.optimize)
      setSelected((previous) =>
        next.setups.some((setup) => setup.kind === previous)
          ? previous
          : (next.setups[0]?.kind ?? 'current'),
      )
    }
  }
  useEffect(() => {
    if (initialSection === undefined) return
    active.current = initialSection.inputs.request
    latestAsOf.current = initialSection.asOf
  }, [initialSection])

  useEffect(() => {
    const unsubscribe = port.subscribe((value) => {
      const parsed = estimateSectionSchema.safeParse(value)
      if (!parsed.success) {
        setError(UI_TEXT.estimateDisclosureMissing)
        return
      }
      const request = active.current
      const next = parsed.data
      if (
        request === undefined ||
        !isSameView(next.inputs.request, request) ||
        Date.parse(next.asOf) <= Date.parse(latestAsOf.current)
      )
        return
      pending.current?.abort()
      latestAsOf.current = next.asOf
      setBusy(false)
      setError('')
      setSection(next)
    })
    return () => {
      // The adapter is being replaced (or the panel closed): drop its request,
      // forecast and activity so a late update cannot land on the next adapter.
      // On unmount these state writes are harmless no-ops.
      spinCycle.current += 1
      pending.current?.abort()
      pending.current = undefined
      active.current = undefined
      latestAsOf.current = ''
      setBusy(false)
      setSpinning(false)
      setSection(undefined)
      setError('')
      unsubscribe()
    }
  }, [port])

  async function run() {
    pending.current?.abort()
    const parsedGoal = parseEstimateGoal(goal)
    let date: string | undefined
    if (deadline !== '') date = deadline.includes('T') ? deadline : `${deadline}T00:00:00.000Z`
    const parsed = estimateRequestSchema.safeParse({
      ...port.context(),
      goal: parsedGoal,
      fleet,
      optimize,
      ...(date && { deadline: date }),
      ...(initial?.seed && { seed: initial.seed }),
    })
    if (!parsed.success) {
      setError(UI_TEXT.estimateInvalidGoal)
      active.current = undefined
      setSection(undefined)
      setBusy(false)
      return
    }
    const controller = new AbortController()
    pending.current = controller
    const expectedRequest = JSON.stringify(parsed.data)
    active.current = estimateRequestSchema.parse(parsed.data)
    latestAsOf.current = parsed.data.asOf
    setBusy(true)
    setError('')
    setSection(undefined)
    try {
      const next = estimateSectionSchema.parse(await port.estimate(parsed.data, controller.signal))
      if (controller.signal.aborted) return
      if (JSON.stringify(next.inputs.request) !== expectedRequest)
        throw new Error('request-mismatch')
      setSection(next)
      setSelected(
        next.setups.some((setup) => setup.kind === selected)
          ? selected
          : (next.setups[0]?.kind ?? 'current'),
      )
    } catch (error: unknown) {
      if (
        !controller.signal.aborted &&
        !(error instanceof DOMException && error.name === 'AbortError')
      )
        setError(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
    } finally {
      if (pending.current === controller && !controller.signal.aborted) setBusy(false)
    }
  }

  async function spinUp() {
    const setup = section?.setups.find((candidate) => candidate.kind === selected)
    if (
      spinning ||
      section === undefined ||
      setup === undefined ||
      setup.provisioning === 'adviceOnly' ||
      ((setup.provisioning !== 'existing' || port.startExisting === undefined) &&
        port.provision.state !== 'ready')
    )
      return
    setSpinning(true)
    setError('')
    const cycle = spinCycle.current
    try {
      if (setup.provisioning === 'existing' && port.startExisting !== undefined)
        await port.startExisting(section, setup)
      else if (port.provision.state === 'ready') await port.provision.spinUp(section, setup)
    } catch {
      if (cycle === spinCycle.current)
        setError(fill(UI_TEXT.estimateFailed, { detail: 'start-unavailable' }))
    } finally {
      if (cycle === spinCycle.current) setSpinning(false)
    }
  }

  const setup = section?.setups.find((candidate) => candidate.kind === selected)
  let waiting = ''
  if (
    port.provision.state === 'waiting' &&
    (setup?.provisioning !== 'existing' || port.startExisting === undefined)
  )
    waiting = fill(UI_TEXT.estimateWaiting, { dependency: port.provision.dependency })
  else if (setup?.provisioning === 'adviceOnly') waiting = UI_TEXT.estimateAdvice
  return (
    <section className="estimator" aria-labelledby={`${id}-title`} inert={isInert}>
      <h1 id={`${id}-title`}>{UI_TEXT.estimateTitle}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void run()
        }}
        className="estimator-form"
      >
        <label htmlFor={`${id}-goal`}>{UI_TEXT.estimateGoal}</label>
        <input
          id={`${id}-goal`}
          value={goal}
          onChange={(event) => {
            setGoal(event.target.value)
          }}
          required
        />
        <label htmlFor={`${id}-deadline`}>{UI_TEXT.estimateDeadline}</label>
        <input
          id={`${id}-deadline`}
          value={deadline}
          onChange={(event) => {
            setDeadline(event.target.value)
          }}
        />
        <label htmlFor={`${id}-fleet`}>{UI_TEXT.estimateMachines}</label>
        <select
          id={`${id}-fleet`}
          value={fleet}
          onChange={(event) => {
            const value = estimateRequestSchema.shape.fleet.safeParse(event.target.value)
            if (value.success) setFleet(value.data)
          }}
        >
          <option value="current">{UI_TEXT.estimateCurrent}</option>
          <option value="minimum">{UI_TEXT.estimateMinimum}</option>
          <option value="optimum">{UI_TEXT.estimateOptimum}</option>
        </select>
        <label htmlFor={`${id}-optimize`}>{UI_TEXT.estimateOptimization}</label>
        <select
          id={`${id}-optimize`}
          value={optimize}
          onChange={(event) => {
            const value = estimateRequestSchema.shape.optimize.safeParse(event.target.value)
            if (value.success) setOptimize(value.data)
          }}
        >
          <option value="cost">{UI_TEXT.estimateCost}</option>
          <option value="speed">{UI_TEXT.estimateSpeed}</option>
        </select>
        <button type="submit" disabled={busy}>
          {section === undefined ? UI_TEXT.estimateRun : UI_TEXT.estimateRefresh}
        </button>
      </form>
      <p role="status">{busy ? UI_TEXT.estimateRunning : ''}</p>
      {error !== '' && <p role="alert">{error}</p>}
      {section !== undefined && (
        <>
          <dl className="estimator-forecast">
            <dt>{UI_TEXT.estimateP50}</dt>
            <dd>
              <time dateTime={section.p50}>{formatDateTime(Date.parse(section.p50))}</time>
            </dd>
            <dt>{UI_TEXT.estimateP90}</dt>
            <dd>
              <time dateTime={section.p90}>{formatDateTime(Date.parse(section.p90))}</time>
            </dd>
            <dt>{UI_TEXT.estimateBottleneck}</dt>
            <dd>
              {resourceName(section.limitingResource.kind)}
              {section.limitingResource.resourceId && ` (${section.limitingResource.resourceId})`}
            </dd>
          </dl>
          {section.limitingResource.kind === 'criticalPath' && (
            <p>{UI_TEXT.estimateCriticalBound}</p>
          )}
          {section.drift !== undefined && (
            <p role="status">
              {UI_TEXT.estimateDrift}: {UI_TEXT.estimateP50}:{' '}
              {formatUnit(section.drift.p50Hours, 'hour')} · {UI_TEXT.estimateP90}:{' '}
              {formatUnit(section.drift.p90Hours, 'hour')}
            </p>
          )}
          {(section.risks ?? []).length > 0 && (
            <p role="alert">
              {fill(UI_TEXT.estimateStaleBase, {
                lanes: (section.risks ?? []).map((risk) => risk.laneId).join(', '),
              })}
            </p>
          )}
          {section.currentRefusal !== undefined && (
            <p role="alert">{fill(UI_TEXT.estimateFailed, { detail: section.currentRefusal })}</p>
          )}
          {(section.qualifications ?? []).map((row) =>
            row.unknownLimits.length === 0 ? null : (
              <p key={row.setup} role="status">
                {setupName(row.setup)} · {UI_TEXT.estimateUncertainty}:{' '}
                {row.unknownLimits.join(', ')}
              </p>
            ),
          )}
          <Gantt section={section} />
          <fieldset className="estimator-setups">
            <legend>{UI_TEXT.estimateMachines}</legend>
            {section.setups.map((card) => (
              <label key={card.kind} className="estimator-card">
                <span>
                  <input
                    type="radio"
                    name={`${id}-setup`}
                    value={card.kind}
                    checked={selected === card.kind}
                    onChange={() => {
                      setSelected(card.kind)
                    }}
                  />
                  {setupName(card.kind)}
                </span>
                <span>
                  {UI_TEXT.estimateP50}: {formatDateTime(Date.parse(card.p50))}
                </span>
                <span>
                  {UI_TEXT.estimateP90}: {formatDateTime(Date.parse(card.p90))}
                </span>
                {card.machines.map((machine) => (
                  <span key={machine.classId}>
                    {machine.classId}: {UI_TEXT.estimateMachines}: {formatNumber(machine.count)} ·{' '}
                    {UI_TEXT.estimateSlots}: {formatNumber(machine.slots)} ·{' '}
                    {UI_TEXT.estimateAccounts}: {formatNumber(machine.accounts)}
                    <br />
                    {UI_TEXT.estimateMarginal}: {formatUnit(machine.marginalP50Hours, 'hour')} /{' '}
                    {formatUnit(machine.marginalP90Hours, 'hour')}
                    <br />
                    {machine.price === undefined ? (
                      UI_TEXT.estimateNoPrice
                    ) : (
                      <>
                        {UI_TEXT.estimateHourly}: {port.price(machine.price)}
                        <br />
                        {fill(UI_TEXT.estimateCatalog, {
                          date: new Intl.DateTimeFormat(uiLocale(), {
                            dateStyle: 'medium',
                            timeZone: 'UTC',
                          }).format(Date.parse(machine.price.catalogDate)),
                        })}{' '}
                        <a href={machine.price.catalogUrl} rel="noreferrer">
                          {machine.price.providerId}
                        </a>
                      </>
                    )}
                  </span>
                ))}
                {card.provisioning === 'adviceOnly' && <span>{UI_TEXT.estimateAdvice}</span>}
              </label>
            ))}
          </fieldset>
          <button
            type="button"
            disabled={waiting !== '' || setup === undefined || spinning}
            aria-describedby={`${id}-waiting`}
            onClick={() => {
              void spinUp()
            }}
          >
            {UI_TEXT.estimateSpinUp}
          </button>
          <p id={`${id}-waiting`}>{waiting}</p>
          <section aria-labelledby={`${id}-calibration`}>
            <h2 id={`${id}-calibration`}>{UI_TEXT.estimateCalibration}</h2>
            <ul>
              {section.calibration.map((row) => (
                <li key={`${row.kind}:${row.machineClassId}:${row.engine ?? ''}`}>
                  {row.kind} / {row.machineClassId}
                  {row.engine !== undefined && ` / ${row.engine}`}:{' '}
                  {row.basis === 'uncalibratedPrior'
                    ? UI_TEXT.estimatePrior
                    : UI_TEXT.estimateFitted}{' '}
                  · {UI_TEXT.estimateSampleSize}: {formatNumber(row.samples)}
                </li>
              ))}
            </ul>
            <p>{UI_TEXT.estimateHistoryPrivacy}</p>
            <details>
              <summary>{UI_TEXT.estimateInputs}</summary>
              <pre>{JSON.stringify(section.inputs, null, 2)}</pre>
            </details>
            <details>
              <summary>
                {UI_TEXT.estimateBasis} · {UI_TEXT.estimateUncertainty}
              </summary>
              <pre>
                {JSON.stringify(
                  { calibration: section.calibration, disclosures: section.disclosures },
                  null,
                  2,
                )}
              </pre>
            </details>
            <p>
              {UI_TEXT.estimateAsOf}: {formatDateTime(Date.parse(section.asOf))} ·{' '}
              {UI_TEXT.estimateSeed}: {section.seed}
            </p>
          </section>
        </>
      )}
    </section>
  )
}

function isSameView(a: EstimateRequest, b: EstimateRequest): boolean {
  return JSON.stringify({ ...a, asOf: '' }) === JSON.stringify({ ...b, asOf: '' })
}
function goalText(request: EstimateRequest): string {
  const goal = request.goal
  switch (goal.kind) {
    case 'milestone': {
      return goal.milestoneId
    }
    case 'lanes': {
      return `${goal.milestoneId}:${goal.laneIds.join(',')}`
    }
    case 'pullRequest': {
      return `pr:${String(goal.number)}`
    }
    case 'issues': {
      return `issues:${goal.numbers.join(',')}`
    }
    case 'label': {
      return `label:${goal.label}`
    }
    case 'release': {
      return `release:${goal.release}`
    }
  }
}

function Gantt({ section }: { readonly section: EstimateSection }) {
  const [expanded, setExpanded] = useState<string>()
  const id = useId()
  const start = Date.parse(section.asOf)
  const span = Math.max(
    1,
    Date.parse(section.p90) - start,
    ...section.schedule.map((row) => Date.parse(row.end) - start),
  )
  const position = (instant: string) =>
    Math.max(0, Math.min(100, ((Date.parse(instant) - start) / span) * 100))
  return (
    <section aria-labelledby={`${id}-schedule`} className="estimator-gantt">
      <h2 id={`${id}-schedule`}>{UI_TEXT.estimateSchedule}</h2>
      <p>{fill(UI_TEXT.estimateGantt, { goal: goalText(section.inputs.request) })}</p>
      <div className="estimator-marks" aria-hidden="true">
        <span style={{ left: `${String(position(section.p50))}%` }}>P50</span>
        <span style={{ left: `${String(position(section.p90))}%` }}>P90</span>
      </div>
      {section.schedule.length === 0 && <p>{UI_TEXT.estimateEmpty}</p>}
      <ul>
        {section.schedule.map((row, index) => (
          <li key={row.laneId}>
            <button
              type="button"
              aria-expanded={expanded === row.laneId}
              aria-controls={`${id}-${String(index)}`}
              onClick={() => {
                setExpanded(expanded === row.laneId ? undefined : row.laneId)
              }}
            >
              {row.laneId}
              {row.critical && ` · ${UI_TEXT.estimateCriticalPath}`}
              <br />
              {formatDateTime(Date.parse(row.start))} → {formatDateTime(Date.parse(row.end))}
            </button>
            <div className="estimator-track" aria-hidden="true">
              <span
                className={row.critical ? 'estimator-bar estimator-critical' : 'estimator-bar'}
                style={{
                  marginLeft: `${String(position(row.start))}%`,
                  width: `${String(Math.max(0, position(row.end) - position(row.start)))}%`,
                }}
              />
            </div>
            <div id={`${id}-${String(index)}`} hidden={expanded !== row.laneId}>
              {UI_TEXT.estimateMachines}: {row.machineId} · {UI_TEXT.estimateSlots}:{' '}
              {row.slotIds.join(', ')} · {UI_TEXT.estimateAccounts}: {row.accountIds.join(', ')}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
