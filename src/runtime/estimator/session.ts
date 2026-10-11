import { failedEstimate, type EstimateViewState } from '../../shared/estimateDiagnostic'
import { EstimateDiagnosticError, parseEstimate } from '../../core/estimator/diagnostic'
import * as z from 'zod/mini'
import { estimateLaneSchema, estimateRequestSchema } from '../../shared/estimate'
import { UI_TEXT } from '../../shared/l10n/text'
import {
  collectEstimate,
  estimateFailureText,
  estimateDrift,
  renderEstimate,
  type EstimateCommandOptions,
  type EstimateContext,
  type EstimateFormatPort,
  type EstimateRunPort,
} from './command'

/** M115's adapter projects its captured event here; this is not an M115 wire frame. */
export interface EstimateFinishedPort {
  subscribe(listener: (event: unknown) => void): () => void
}
const finishedSchema = z.strictObject({
  laneId: estimateLaneSchema.shape.id,
  asOf: estimateRequestSchema.shape.asOf,
})

/** One portable estimate view, shared by the panel, TUI and report refresh binding. */
export class EstimateViewSession {
  private current: EstimateViewState = { status: 'idle' }
  private pending: AbortController | undefined
  private generation = 0
  private disposed = false
  private latestAsOf: string
  private readonly unsubscribe: () => void

  public constructor(
    private readonly options: EstimateCommandOptions,
    private readonly context: EstimateContext,
    private readonly runner: EstimateRunPort,
    finished: EstimateFinishedPort,
    private readonly publish: (state: EstimateViewState) => void,
  ) {
    this.latestAsOf = parseEstimate(estimateRequestSchema.shape.asOf, context.asOf)
    this.unsubscribe = finished.subscribe((event) => {
      if (this.disposed) return
      const parsed = finishedSchema.safeParse(event)
      if (!parsed.success) {
        this.fail(new EstimateDiagnosticError('invalid-lane-finished'))
        return
      }
      // Before the first result lands the lane set is unknown, so a completion
      // cannot be checked for relevance yet: treat it as relevant and let the
      // superseded calculation's late result fall to the generation check.
      if (
        (this.current.status === 'showing' &&
          this.current.section.inputs.lanes.every((lane) => lane.id !== parsed.data.laneId)) ||
        Date.parse(parsed.data.asOf) <= Date.parse(this.latestAsOf)
      )
        return
      void this.refresh(parsed.data.asOf)
    })
  }

  /** Other refresh/close callbacks can change these fields across await. */
  private isCurrent(generation: number, controller: AbortController): boolean {
    return (
      !this.disposed &&
      generation === this.generation &&
      this.pending === controller &&
      !controller.signal.aborted
    )
  }

  private fail(error: unknown): void {
    this.pending?.abort()
    this.pending = undefined
    this.generation += 1
    this.current = failedEstimate(error)
    this.publish(this.current)
  }

  public async refresh(asOf = this.latestAsOf): Promise<void> {
    if (this.disposed) return
    const parsed = estimateRequestSchema.shape.asOf.safeParse(asOf)
    if (!parsed.success || Date.parse(asOf) < Date.parse(this.latestAsOf)) {
      this.fail(new EstimateDiagnosticError('invalid-snapshot'))
      return
    }
    const previous = this.current.status === 'showing' ? this.current.section : undefined
    this.current = { status: 'loading' }
    this.publish(this.current)
    this.latestAsOf = asOf
    this.pending?.abort()
    const controller = new AbortController()
    this.pending = controller
    const generation = ++this.generation
    try {
      const section = await collectEstimate(
        this.options,
        { ...this.context, asOf },
        this.runner,
        controller.signal,
      )
      if (!this.isCurrent(generation, controller)) return
      const result = previous === undefined ? section : estimateDrift(section, previous)
      this.current = { status: 'showing', section: result }
      this.publish(this.current)
    } catch (error: unknown) {
      if (this.isCurrent(generation, controller)) this.fail(error)
    } finally {
      if (this.isCurrent(generation, controller)) this.pending = undefined
    }
  }

  public dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.pending?.abort()
    this.unsubscribe()
  }
}

/** M110a0 T binds an actual terminal/MHP view; no terminal is fabricated here. */
export async function openEstimateTui(
  options: EstimateCommandOptions,
  deps: {
    readonly context: EstimateContext
    readonly runner: EstimateRunPort
    readonly finished: EstimateFinishedPort
    readonly money: EstimateFormatPort
    view(callbacks: { refresh(): Promise<void>; close(): void }): {
      show(title: string, text: string): void
    }
  },
): Promise<EstimateViewSession> {
  const state: { session?: EstimateViewSession; isClosed: boolean } = { isClosed: false }
  const view = deps.view({
    refresh: () => {
      return state.session === undefined
        ? Promise.reject(new EstimateDiagnosticError('running', UI_TEXT.estimateRunning))
        : state.session.refresh()
    },
    close: () => {
      state.isClosed = true
      state.session?.dispose()
    },
  })
  const session = new EstimateViewSession(
    options,
    deps.context,
    deps.runner,
    deps.finished,
    (state) => {
      let text = ''
      switch (state.status) {
        case 'showing': {
          text = renderEstimate(state.section, 'text', deps.money)
          break
        }
        case 'failed': {
          text = estimateFailureText(state.diagnostic)
          break
        }
        case 'loading': {
          text = UI_TEXT.estimateRunning
          break
        }
      }
      view.show(UI_TEXT.estimateTitle, text)
    },
  )
  state.session = session
  if (state.isClosed) session.dispose()
  else await session.refresh()
  return session
}
