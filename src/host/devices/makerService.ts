// RLF-DEVICES: the window's maker assembly (dist/maker.js): the three
// executors and the simulators they run against, asking through the
// Devices panel surface the caller hands in. M103's tool paths build
// this through the maker entry; the panel snapshot and request flows
// already route prompts and answers through the surface.
import type { MakerTarget } from '../../shared/maker'
import {
  MakerApprovals,
  MakerPresencePort,
  type MakerApprovalAsker,
} from '../../core/maker/approval'
import type { MakerAnalysisOutcome } from '../../core/maker/analysis'
import {
  CncExecutor,
  McuExecutor,
  PrinterExecutor,
  type MakerExecutorDeps,
  type MakerMachineConnection,
} from '../../core/maker/executors'
import {
  CncSimulator,
  McuSimulator,
  PrinterSimulator,
  cncSimRecord,
  mcuSimRecord,
  printerSimRecord,
} from '../../core/maker/simulators'
import type { PanelMakerSurface } from './makerSurface'

export interface MakerServiceDeps {
  /** The live panel surface: prompts queue there, answers settle them. */
  readonly surface: PanelMakerSurface
  readonly approvals?: MakerApprovals
  readonly now?: () => number
}

export interface MakerPresenceBindingInput {
  readonly readState: () => string
  readonly analyze?: (payload: Uint8Array) => MakerAnalysisOutcome | undefined
  readonly expiresAt?: number
}

/**
The window's maker assembly: the three executors and the simulators
they run against. One surface serves the panel and every execution:
the caller hands in the surface the panel snapshot already carries.
*/
export class MakerService {
  public readonly surface: PanelMakerSurface
  public readonly approvals: MakerApprovals
  public readonly printer: PrinterExecutor
  public readonly cnc: CncExecutor
  public readonly mcu: McuExecutor
  public readonly simulators: {
    readonly printer: MakerMachineConnection
    readonly cnc: MakerMachineConnection
    readonly mcu: MakerMachineConnection
  }
  public constructor(deps: MakerServiceDeps) {
    this.surface = deps.surface
    this.approvals = deps.approvals ?? new MakerApprovals()
    const executorDeps: MakerExecutorDeps = {
      approvals: this.approvals,
      ...(deps.now !== undefined && { now: deps.now }),
    }
    this.printer = new PrinterExecutor(executorDeps)
    this.cnc = new CncExecutor(executorDeps)
    this.mcu = new McuExecutor(executorDeps)
    this.simulators = {
      printer: new PrinterSimulator(printerSimRecord()),
      cnc: new CncSimulator(cncSimRecord()),
      mcu: new McuSimulator(mcuSimRecord()),
    }
  }

  /** The panel asker as the engine's asker port. */
  public asker(): MakerApprovalAsker {
    return (prompt, signal) => this.surface.ask(prompt, signal)
  }

  /** A presence port bound to this surface for one action's target. */
  public presenceFor(target: MakerTarget, bindings: MakerPresenceBindingInput): MakerPresencePort {
    return new MakerPresencePort(this.approvals, this.asker(), { target, ...bindings })
  }
}
