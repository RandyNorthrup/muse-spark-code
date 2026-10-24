// M125 lane W (D107 §8.1): the setup wizard's driver. The panel (or
// any future surface) calls `command` with each validated wizard
// command; the controller runs the scan, the recommender and the
// shared install flow, and answers with snapshots and directives.
// UI-free and abortable: the panel owns the surface, the controller
// owns the work.
import path from 'node:path'
import { UI_TEXT } from '../../../shared/constants'
import { isSetupModelPick, setupLegalCommands, setupTransition } from '../../../shared/judgeSetup'
import type {
  JudgeSetupCommand,
  JudgeSetupCommandMessage,
  JudgeSetupSnapshot,
} from '../../../shared/judgeSetupSchema'
import { fill, formatNumber } from '../../../shared/l10n/text'
import type { HardwareSummary } from '../hardware/types'
import { eligible, FAST_DECISIONS, FAST_TIMING_CLASSES } from '../fast/classes'
import { planJudgeSetup, runJudgeSetupFlow, type JudgeSetupPlan } from './flow'
import type { JudgeSetupPaths, JudgeSetupPorts } from './ports'
import { scanSummaryLines } from './ports'
import { className, recommendJudgeModel } from './recommend'

export type JudgeSetupDirective =
  | { readonly to: 'snapshot'; readonly snapshot: JudgeSetupSnapshot }
  | { readonly to: 'close'; readonly openHosted: boolean }

export class JudgeSetupController {
  private summary: HardwareSummary | undefined = undefined
  private cpuOnly = false
  private chosen: string | undefined = undefined
  private snapshot: JudgeSetupSnapshot = { step: 'scan', running: false, summary: [] }
  private aborted = false
  private readonly controllers = new Set<AbortController>()

  constructor(
    private readonly paths: JudgeSetupPaths,
    private readonly ports: JudgeSetupPorts,
  ) {}

  private track(): AbortSignal {
    const controller = new AbortController()
    if (this.aborted) controller.abort()
    this.controllers.add(controller)
    return controller.signal
  }

  private untrack(signal: AbortSignal): void {
    for (const controller of this.controllers) {
      if (controller.signal === signal) this.controllers.delete(controller)
    }
  }

  private recommend(): JudgeSetupSnapshot {
    const summary = this.summary
    if (summary === undefined) return this.snapshot
    const loaded = this.ports.loadTable(this.paths.tableFile, this.ports.today())
    if (loaded.table === undefined) {
      return { step: 'scan', running: false, summary: [], error: 'table-invalid' }
    }
    const settled = planJudgeSetup(summary, loaded.table, {
      ...(this.chosen !== undefined && { model: this.chosen }),
      ...(this.cpuOnly && { cpuOnly: true }),
    })
    if (!settled.ok) {
      return {
        step: 'recommendation',
        backend: this.cpuOnly ? 'cpu' : summary.gpu.backend,
        classes: [],
        fitting: [],
        reasons: [...recommendJudgeModel(summary, loaded.table).reasons],
        cpuOnly: this.cpuOnly,
        hosted: false,
      }
    }
    return this.recommendationOf(settled.plan)
  }

  private recommendationOf(plan: JudgeSetupPlan): JudgeSetupSnapshot {
    return {
      step: 'recommendation',
      model: plan.row.model,
      digest: plan.row.digest,
      downloadBytes: plan.row.downloadBytes,
      backend: plan.recommendation.backend,
      ...(plan.recommendation.p95Ms !== undefined && { p95Ms: plan.recommendation.p95Ms }),
      classes: [...plan.recommendation.classes],
      fitting: [...plan.recommendation.fitting],
      reasons: [...plan.recommendation.reasons],
      cpuOnly: this.cpuOnly,
      hosted: false,
    }
  }

  private async runScan(): Promise<JudgeSetupSnapshot> {
    const signal = this.track()
    try {
      const summary = await this.ports.scan({ installPath: this.paths.storageRoot })
      this.summary = summary
      this.snapshot = {
        step: 'scan',
        running: false,
        summary: scanSummaryLines(summary),
      }
      return this.recommend()
    } finally {
      this.untrack(signal)
    }
  }

  private async runInstall(
    onSnapshot: (snapshot: JudgeSetupSnapshot) => void,
  ): Promise<JudgeSetupDirective> {
    if (this.summary === undefined) return { to: 'snapshot', snapshot: this.snapshot }
    const plan = this.plan()
    if (plan === undefined) return { to: 'snapshot', snapshot: this.recommend() }
    const signal = this.track()
    try {
      const result = await runJudgeSetupFlow({
        plan,
        paths: this.paths,
        ports: this.ports.flow,
        join: (...parts: string[]) => path.join(...parts),
        onProgress: (progress) => {
          const installing: JudgeSetupSnapshot = {
            step: 'install',
            model: plan.row.model,
            phase: progress.phase,
            ...(progress.doneBytes !== undefined && { doneBytes: progress.doneBytes }),
            ...(progress.totalBytes !== undefined && { totalBytes: progress.totalBytes }),
          }
          this.snapshot = installing
          onSnapshot(installing)
        },
        signal,
        nowIso: this.ports.nowIso,
      })
      if (!result.ok) {
        const failed: JudgeSetupSnapshot = {
          step: 'install',
          model: plan.row.model,
          phase: result.phase,
          error: `${result.phase}/${result.reason}`,
        }
        this.snapshot = failed
        return { to: 'snapshot', snapshot: failed }
      }
      const done: JudgeSetupSnapshot = {
        step: 'done',
        model: plan.row.model,
        backend: plan.recommendation.backend,
        classes: doneClassRows(plan.recommendation.p95Ms),
        checks: doneCheckRows(plan.row.profiledFamilies),
        smokeCorrect: result.verdict.correct,
        smokeTotal: result.verdict.total,
      }
      this.snapshot = done
      return { to: 'snapshot', snapshot: done }
    } finally {
      this.untrack(signal)
    }
  }

  /** Recompute the settled plan from the scan and the current choices. */
  private plan(): JudgeSetupPlan | undefined {
    const summary = this.summary
    if (summary === undefined) return undefined
    const loaded = this.ports.loadTable(this.paths.tableFile, this.ports.today())
    const settled = planJudgeSetup(summary, loaded.table, {
      ...(this.chosen !== undefined && { model: this.chosen }),
      ...(this.cpuOnly && { cpuOnly: true }),
    })
    return settled.ok ? settled.plan : undefined
  }

  /**
  Handle one validated command. Illegal commands for the current step
  are ignored (the surface disables them; the wire cannot be
  trusted). Long work streams intermediate snapshots through
  `onSnapshot`; the directive carries the close or the final step.
  */
  async command(
    message: JudgeSetupCommandMessage,
    onSnapshot: (snapshot: JudgeSetupSnapshot) => void,
  ): Promise<JudgeSetupDirective> {
    const current = this.snapshot
    const action: JudgeSetupCommand = message.command
    if (!setupLegalCommands(current).includes(action)) {
      return { to: 'snapshot', snapshot: current }
    }
    const transition = setupTransition(current, action)
    if (transition.to === 'close') {
      this.abort()
      return { to: 'close', openHosted: action === 'chooseHosted' }
    }
    if (transition.to === 'scan') {
      this.snapshot = {
        step: 'scan',
        running: false,
        summary: this.summary === undefined ? [] : scanSummaryLines(this.summary),
      }
      return { to: 'snapshot', snapshot: this.snapshot }
    }
    if (transition.to === 'recommendation') {
      this.snapshot = this.recommend()
      return { to: 'snapshot', snapshot: this.snapshot }
    }
    switch (current.step) {
      case 'scan': {
        if (action !== 'startScan') return { to: 'snapshot', snapshot: current }
        this.snapshot = { step: 'scan', running: true, summary: [] }
        onSnapshot(this.snapshot)
        this.snapshot = await this.runScan()
        return { to: 'snapshot', snapshot: this.snapshot }
      }
      case 'recommendation': {
        if (action === 'chooseCpuOnly') {
          this.cpuOnly = !this.cpuOnly
          this.snapshot = this.recommend()
          return { to: 'snapshot', snapshot: this.snapshot }
        }
        if (action === 'chooseModel') {
          if (isSetupModelPick(current, action, message.model)) this.chosen = message.model
          this.snapshot = this.recommend()
          return { to: 'snapshot', snapshot: this.snapshot }
        }
        if (action === 'startInstall') {
          const plan = this.plan()
          if (plan === undefined) {
            this.snapshot = this.recommend()
            return { to: 'snapshot', snapshot: this.snapshot }
          }
          if (plan.licence !== undefined) {
            const licence: JudgeSetupSnapshot = {
              step: 'licence',
              model: plan.row.model,
              name: plan.licence.name,
              ...(plan.licence.url !== undefined && { url: plan.licence.url }),
            }
            this.snapshot = licence
            return { to: 'snapshot', snapshot: licence }
          }
          return await this.runInstall(onSnapshot)
        }
        return { to: 'snapshot', snapshot: current }
      }
      case 'licence': {
        return action === 'acceptLicence'
          ? await this.runInstall(onSnapshot)
          : { to: 'snapshot', snapshot: current }
      }
      case 'install': {
        return action === 'startInstall'
          ? await this.runInstall(onSnapshot)
          : { to: 'snapshot', snapshot: current }
      }
      case 'done': {
        return { to: 'snapshot', snapshot: current }
      }
    }
  }

  /** The current snapshot, for the surface's first paint. */
  current(): JudgeSetupSnapshot {
    return this.snapshot
  }

  /** Stop any running work; in-flight commands settle as aborted. */
  abort(): void {
    this.aborted = true
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
  }
}

function formatP95(p95Ms: number | undefined): string {
  return p95Ms === undefined ? UI_TEXT.judgeSetupCli.unknownValue : `${formatNumber(p95Ms)} ms`
}

/**
The Done step's class rows: `eligible` on the installed model's p95 in
a real window (the local judge serves live turns). Off is always over
the deadline there; an unknown p95 stays off, never zero.
*/
export function doneClassRows(
  p95Ms: number | undefined,
): Extract<JudgeSetupSnapshot, { step: 'done' }>['classes'] {
  const text = UI_TEXT.judgeSetup
  const p95 = p95Ms ?? Infinity
  return FAST_TIMING_CLASSES.map((timingClass) => {
    const name = className(timingClass)
    const isOn = eligible(timingClass, p95, 'real')
    return {
      timingClass,
      on: isOn,
      reason: fill(isOn ? text.doneClassOn : text.doneClassOver, {
        class: name,
        p95: formatP95(p95Ms),
      }),
    }
  })
}

/**
The Done step's check rows: a check is calibrated when the installed
row profiles its family. Coverage comes from the row, not from
committed files that do not exist yet.
*/
export function doneCheckRows(
  profiledFamilies: readonly string[],
): Extract<JudgeSetupSnapshot, { step: 'done' }>['checks'] {
  const text = UI_TEXT.judgeSetup
  return FAST_DECISIONS.map((family) => ({
    family,
    on: profiledFamilies.includes(family),
    reason: profiledFamilies.includes(family) ? text.doneCheckOn : text.doneCheckOff,
  }))
}
