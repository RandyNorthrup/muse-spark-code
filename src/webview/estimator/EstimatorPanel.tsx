import { estimateFailureText, type EstimateViewState } from '../../shared/estimateView'
import { Fragment, useEffect, useId, useRef, useState } from 'react'
import {
  estimateRequestSchema,
  isEstimateRefusal,
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
import { useFormatUsd } from '../money'
import './estimator.css'

/**
 * A machine's hourly price (STARTUP017): the port's fake in tests, otherwise
 * the lazy money chunk's exact display. Nothing renders until one is known.
 */
function MachinePrice({
  port,
  price,
}: {
  readonly port: EstimatorPanelPort
  readonly price: CatalogPrice
}) {
  const formatted = useFormatUsd(price.hourlyUsd, 2)
  return port.price === undefined ? <>{formatted ?? null}</> : <>{port.price(price)}</>
}

export interface EstimatorPanelPort {
  context(): Pick<EstimateRequest, 'asOf' | 'optimize'>
  estimate(request: EstimateRequest, signal: AbortSignal): Promise<unknown>
  /** Validated refreshed sections from U's view session, bound to M115 by W. */
  subscribe(listener: (state: EstimateViewState) => void): () => void
  /**
   * The host log's copy of a failure the panel already said in words: the
   * run and spin-up boundaries hand a foreign failure here with its kind
   * (D119). The host reports it through its webview-error channel, so the
   * kind never depends on the document's ambient unhandled-rejection hook.
   */
  report(error: unknown): void
  startExisting?(
    section: EstimateSection,
    setup: EstimateSection['setups'][number],
  ): Promise<unknown>
  price?(price: CatalogPrice): string
  readonly provision:
    | { readonly state: 'waiting'; readonly dependency: string }
    | {
        readonly state: 'ready'
        spinUp(section: EstimateSection, setup: EstimateSection['setups'][number]): Promise<unknown>
      }
}

function setupName(kind: EstimateSection['setups'][number]['kind']): string {
  if (kind === 'current') return UI_TEXT.estimateCurrent
  const label = kind.startsWith('min') ? UI_TEXT.estimateMinimum : UI_TEXT.estimateOptimum
  const detail = setupDetail(kind)
  return `${label} · ${detail}`
}
function setupDetail(kind: EstimateSection['setups'][number]['kind']): string {
  if (kind === 'minimumP50') return UI_TEXT.estimateP50
  if (kind === 'minimumP90') return UI_TEXT.estimateP90
  return kind === 'optimumCost' ? UI_TEXT.estimateCost : UI_TEXT.estimateSpeed
}
/** Entry for W's dedicated lazy panel chunk; no host, backend or runtime import. */
export default function EstimatorPanel({
  port,
  initial,
  initialState,
  isInert = false,
}: {
  readonly port: EstimatorPanelPort
  readonly initial?: EstimateRequest | undefined
  readonly initialState?: EstimateViewState | undefined
  readonly isInert?: boolean
}) {
  const id = useId()
  const [goal, setGoal] = useState(initial === undefined ? '' : goalText(initial))
  const [deadline, setDeadline] = useState(initial?.deadline ?? '')
  const [fleet, setFleet] = useState<EstimateRequest['fleet']>(initial?.fleet ?? 'current')
  const [optimize, setOptimize] = useState<EstimateRequest['optimize']>(
    () => initial?.optimize ?? port.context().optimize,
  )
  const [view, setView] = useState<EstimateViewState>(initialState ?? { status: 'idle' })
  const section = view.status === 'showing' ? view.section : undefined
  const isBusy = view.status === 'loading'
  // A section without a current setup still opens on its first available
  // setup; the radio must never point at a card that is not rendered.
  const [selected, setSelected] = useState<EstimateSection['setups'][number]['kind']>(
    section?.setups[0]?.kind ?? 'current',
  )
  const [spinning, setSpinning] = useState(false)
  const active = useRef<EstimateRequest | undefined>(section?.inputs.request)
  const pending = useRef<AbortController | undefined>(undefined)
  const spinCycle = useRef(0)
  const latestAsOf = useRef(section?.asOf ?? '')

  const [received, setReceived] = useState(initialState)
  if (received !== initialState) {
    setReceived(initialState)
    setView(initialState ?? { status: 'idle' })
    if (initialState?.status === 'showing') {
      const next = initialState.section
      setGoal(goalText(next.inputs.request))
      setDeadline(next.inputs.request.deadline ?? '')
      setFleet(next.inputs.request.fleet)
      setOptimize(next.inputs.request.optimize)
      setSelected((previous) => chooseSetup(next, previous))
    }
  }
  useEffect(() => {
    if (initialState?.status !== 'showing') return
    active.current = initialState.section.inputs.request
    latestAsOf.current = initialState.section.asOf
  }, [initialState])

  useEffect(() => {
    const unsubscribe = port.subscribe((value) => {
      if (value.status !== 'showing') {
        pending.current?.abort()
        setView(value)
        return
      }
      const request = active.current
      const next = value.section
      if (
        request === undefined ||
        !isSameView(next.inputs.request, request) ||
        Date.parse(next.asOf) <= Date.parse(latestAsOf.current)
      )
        return
      pending.current?.abort()
      latestAsOf.current = next.asOf
      setView({ status: 'showing', section: next })
      setSelected((previous) => chooseSetup(next, previous))
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
      setSpinning(false)
      setView({ status: 'idle' })
      unsubscribe()
    }
  }, [port])

  async function run() {
    spinCycle.current += 1
    setSpinning(false)
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
      setView({ status: 'failed', diagnostic: { estimateDiagnostic: 'invalid-input' } })
      active.current = undefined
      return
    }
    const controller = new AbortController()
    pending.current = controller
    active.current = structuredClone(parsed.data)
    latestAsOf.current = parsed.data.asOf
    setView({ status: 'loading' })
    let next: EstimateViewState
    try {
      const boundary = await import('../../shared/estimateDiagnostic')
      try {
        next = await boundary.collectEstimateView(
          parsed.data,
          () => port.estimate(parsed.data, controller.signal),
          controller.signal,
        )
      } catch (error: unknown) {
        // A cancelled run stays silent: a stillborn run reads failed. A
        // refusal said everything on the panel; only a foreign failure
        // keeps its kind past the panel through the port's report for the
        // host log (D119).
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
        next = boundary.failedEstimate(error)
        if (!isEstimateRefusal(error)) port.report(error)
      }
    } catch {
      next = { status: 'failed', diagnostic: { estimateDiagnostic: 'source-unavailable' } }
    }
    if (controller.signal.aborted) return
    setView(next)
    if (next.status === 'showing') setSelected(chooseSetup(next.section, selected))
  }

  async function spinUp() {
    if (spinning || section === undefined || setup === undefined || !canStart()) return
    setSpinning(true)
    const cycle = spinCycle.current
    try {
      let failure: unknown
      try {
        if (canUseExisting() && port.startExisting !== undefined)
          failure = await port.startExisting(section, setup)
        else if (port.provision.state === 'ready')
          failure = await port.provision.spinUp(section, setup)
      } catch (error: unknown) {
        // A thrown start keeps its kind past the panel through the port's
        // report for the host log (D119); a resolved failure value is the
        // host's own verdict, already on its side.
        failure = error
        port.report(error)
      }
      if (failure !== undefined) {
        const diagnostic = await import('../../shared/estimateDiagnostic')
        if (cycle === spinCycle.current) setView(diagnostic.failedEstimate(failure))
      }
    } finally {
      if (cycle === spinCycle.current) setSpinning(false)
    }
  }

  const setup = section?.setups.find((candidate) => candidate.kind === selected)
  const provisioning = setup?.provisioning
  function canUseExisting(): boolean {
    return provisioning === 'existing' && port.startExisting !== undefined
  }
  function canStart(): boolean {
    return (
      provisioning !== undefined &&
      provisioning !== 'adviceOnly' &&
      (port.provision.state === 'ready' || canUseExisting())
    )
  }
  let waiting = ''
  // With no selected setup there is nothing to spin up: report nothing
  // rather than the rental-provider wait for a card that is not selected.
  if (setup !== undefined && port.provision.state === 'waiting' && !canUseExisting())
    waiting = fill(UI_TEXT.estimateWaiting, { dependency: port.provision.dependency })
  else if (provisioning === 'adviceOnly') waiting = UI_TEXT.estimateAdvice
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
          onChange={selectValue(estimateRequestSchema.shape.fleet, setFleet)}
        >
          <option value="current">{UI_TEXT.estimateCurrent}</option>
          <option value="minimum">{UI_TEXT.estimateMinimum}</option>
          <option value="optimum">{UI_TEXT.estimateOptimum}</option>
        </select>
        <label htmlFor={`${id}-optimize`}>{UI_TEXT.estimateOptimization}</label>
        <select
          id={`${id}-optimize`}
          value={optimize}
          onChange={selectValue(estimateRequestSchema.shape.optimize, setOptimize)}
        >
          <option value="cost">{UI_TEXT.estimateCost}</option>
          <option value="speed">{UI_TEXT.estimateSpeed}</option>
        </select>
        <button type="submit" disabled={isBusy}>
          {section === undefined ? UI_TEXT.estimateRun : UI_TEXT.estimateRefresh}
        </button>
      </form>
      <p role="status">{isBusy ? UI_TEXT.estimateRunning : ''}</p>
      {view.status === 'failed' && <p role="alert">{estimateFailureText(view.diagnostic)}</p>}
      {section !== undefined && (
        <>
          <dl className="estimator-forecast">
            {QUANTILES.map((key) => (
              <Fragment key={key}>
                <dt>{quantileName(key)}</dt>
                <dd>
                  <time dateTime={section[key]}>{formatInstant(section[key])}</time>
                </dd>
              </Fragment>
            ))}
            <dt>{UI_TEXT.estimateBottleneck}</dt>
            <dd>
              {
                {
                  machines: UI_TEXT.estimateMachines,
                  slots: UI_TEXT.estimateSlots,
                  accountRate: UI_TEXT.estimateAccounts,
                  ci: UI_TEXT.estimateCi,
                  disk: UI_TEXT.estimateDisk,
                  criticalPath: UI_TEXT.estimateCriticalPath,
                }[section.limitingResource.kind]
              }
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
            <p role="alert">
              {estimateFailureText({ estimateDiagnostic: section.currentRefusal })}
            </p>
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
                {QUANTILES.map((key) => (
                  <span key={key}>
                    {quantileName(key)}: {formatInstant(card[key])}
                  </span>
                ))}
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
                        {UI_TEXT.estimateHourly}: <MachinePrice port={port} price={machine.price} />
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
            disabled={!canStart() || spinning}
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
              {UI_TEXT.estimateAsOf}: {formatInstant(section.asOf)} · {UI_TEXT.estimateSeed}:{' '}
              {section.seed}
            </p>
          </section>
        </>
      )}
    </section>
  )
}

function selectValue<T>(
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  set: (value: T) => void,
) {
  return (event: { target: { value: string } }) => {
    const parsed = schema.safeParse(event.target.value)
    if (parsed.success) set(parsed.data)
  }
}

const QUANTILES = ['p50', 'p90'] as const
function quantileName(key: (typeof QUANTILES)[number]): string {
  return key === 'p50' ? UI_TEXT.estimateP50 : UI_TEXT.estimateP90
}
function formatInstant(value: string): string {
  return formatDateTime(Date.parse(value))
}
function chooseSetup(
  section: EstimateSection,
  preferred: EstimateSection['setups'][number]['kind'],
) {
  return section.setups.some((setup) => setup.kind === preferred)
    ? preferred
    : (section.setups[0]?.kind ?? 'current')
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
        {QUANTILES.map((key) => (
          <span key={key} style={{ left: `${String(position(section[key]))}%` }}>
            {key.toUpperCase()}
          </span>
        ))}
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
              {formatInstant(row.start)} → {formatInstant(row.end)}
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
