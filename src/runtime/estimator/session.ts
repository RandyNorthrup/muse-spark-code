import { z } from 'zod/mini'
import {
  estimateLaneSchema,
  estimateRequestSchema,
  type EstimateSection,
} from '../../shared/estimate'
import { UI_TEXT, fill } from '../../shared/l10n/text'
import {
  collectEstimate,
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
  private current: EstimateSection | undefined
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
    private readonly publish: (section: EstimateSection) => void,
    private readonly error: (text: string) => void,
  ) {
    this.latestAsOf = estimateRequestSchema.shape.asOf.parse(context.asOf)
    this.unsubscribe = finished.subscribe((event) => {
      if (this.disposed) return
      const parsed = finishedSchema.safeParse(event)
      if (!parsed.success) {
        this.error(fill(UI_TEXT.estimateFailed, { detail: 'invalid-lane-finished' }))
        return
      }
      if (
        this.current?.inputs.lanes.some((lane) => lane.id === parsed.data.laneId) !== true ||
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

  public async refresh(asOf = this.latestAsOf): Promise<void> {
    if (this.disposed) return
    const parsed = estimateRequestSchema.shape.asOf.safeParse(asOf)
    if (!parsed.success || Date.parse(asOf) < Date.parse(this.latestAsOf)) {
      this.error(fill(UI_TEXT.estimateFailed, { detail: 'invalid-snapshot' }))
      return
    }
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
      const result = this.current === undefined ? section : estimateDrift(section, this.current)
      this.current = result
      this.publish(result)
    } catch {
      if (this.isCurrent(generation, controller))
        this.error(fill(UI_TEXT.estimateFailed, { detail: 'estimate-unavailable' }))
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
      error(text: string): void
    }
  },
): Promise<EstimateViewSession> {
  const state: { session?: EstimateViewSession; isClosed: boolean } = { isClosed: false }
  const view = deps.view({
    refresh: () => {
      return state.session === undefined
        ? Promise.reject(new Error(UI_TEXT.estimateRunning))
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
    (section) => {
      view.show(UI_TEXT.estimateTitle, renderEstimate(section, 'text', deps.money))
    },
    (text) => {
      view.error(text)
    },
  )
  state.session = session
  if (state.isClosed) session.dispose()
  else await session.refresh()
  return session
}
