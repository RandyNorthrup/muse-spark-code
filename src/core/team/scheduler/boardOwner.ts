// The board's process lease (M96c): which process owns a window's claim on the
// board, and the proof that it is gone (PLAN.md D75: recovery never touches
// another window's work until that window is proven gone). A window that dies
// without releasing its claim leaves it standing; the next window takes the
// board only on this proof, and anything it cannot prove keeps the claim.
import {
  currentProcessOwner,
  isProcessOwnerGone,
  processOwnerSchema,
  type ProcessOwner,
} from '../../locks/processOwner'
import type { TeamSchedulingOwnerBirth, TeamSchedulingProbeOwner } from '../teamScheduling'

export interface WindowBoardOwner {
  readonly ownerBirth: TeamSchedulingOwnerBirth
  readonly probeOwner: TeamSchedulingProbeOwner
}

/** The owner a claim recorded; undefined when it names none this code can read. */
function recordedOwner(processStart: string | undefined): ProcessOwner | undefined {
  if (processStart === undefined) return undefined
  try {
    const parsed = processOwnerSchema.safeParse(JSON.parse(processStart))
    return parsed.success ? parsed.data : undefined
  } catch (error: unknown) {
    // A claim whose lease is not JSON proves nothing: it stays unprovable.
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

/** This window's birth for its claim, and the probe of another window's. */
export async function windowBoardOwner(now: () => number): Promise<WindowBoardOwner> {
  const owner = await currentProcessOwner()
  return {
    ownerBirth: {
      windowStartedAt: now(),
      pid: owner.pid,
      processStart: JSON.stringify(owner),
    },
    probeOwner: async (claim) => {
      const recorded = recordedOwner(claim.processStart)
      // Not provably gone is live or unknowable, and both keep the claim.
      return recorded !== undefined && (await isProcessOwnerGone(recorded)) ? false : undefined
    },
  }
}
