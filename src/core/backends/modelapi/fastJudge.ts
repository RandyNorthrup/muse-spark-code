// D107 (M125 lane M): the Model API session's fast-judge decisions, built
// into dist/modelApiFast.js with modelApiFastEntry.ts. The session loads it
// when each turn or compaction starts, before its first request, and calls
// it synchronously at the design's points: one settled tool result through
// the loop detector and the first-send triage, the request's effort, what a
// compaction keeps past its tail, and the turn boundary with its queued tail
// notes. Each decision reads the switch and the evaluation pin as it runs;
// with the switch off, every call returns today's bytes unchanged.

import { JUDGE_FAST_KEEP_ENTRIES, MODEL_API_TOOLS } from '../../../shared/constants'
import type { JudgeFastTurn } from '../../../shared/judgeFastTurn'
import type { ModelCapabilityRecord } from '../../providers/capabilityRecord'
import { fingerprint } from '../../verify/fingerprint'
import {
  loopTailNote,
  lowerEffortLevel,
  rankedKeepIds,
  tailNotes,
  triageRoute,
  type FastTailNote,
} from '../../judge/fast/apply'
import { fastEffortScale, type PolicyEffortScale } from '../../judge/fast/engines'
import { ruleEffort } from '../../judge/fast/reflex/effort'
import { detectLoop, toolRepeatKey } from '../../judge/fast/reflex/loop'
import { triageOutput } from '../../judge/fast/reflex/triage'
import { FastTurnBoundary, type FinishedTurnTexts } from '../../judge/fast/turnEnd'
import {
  effortTurnReason,
  keepTurnReason,
  loopTurnReason,
  triageTurnReason,
  type FastDecisionPin,
} from '../../judge/fast/turnRecord'
import type { InputItem } from './schemas'

/** What the session hands its fast judge: the switch, the pin and its own effects. */
export interface FastJudgeHost {
  /** The fast judge's one switch, read at each decision. */
  readonly isOff: () => boolean
  /** The evaluation pin lane V's arms (and the red drill) set, read at each verdict. */
  readonly pin: FastDecisionPin
  /** A closed turn's reply and outputs, read once per close. */
  readonly read: (turnId: string) => FinishedTurnTexts
  readonly emit: (event: JudgeFastTurn) => void
  /** The repeat guard's own notice, in the user's language: the tool and its run. */
  readonly noteRepeating: (tool: string, run: number) => void
  /** Packs a settled output early through M73's own placeholder. */
  readonly markEarly: (callId: string) => void
}

/** A replay entry the judge reads: its turn and its input item. */
export interface FastReplayEntry {
  readonly turnId: string
  readonly item: InputItem
}

/** What one request's effort decision reads. */
export interface FastEffortRequest {
  /** The turn's typed request. */
  readonly request: string
  readonly turnId: string
  readonly replay: readonly FastReplayEntry[]
  /** The configured effort, sent as is unless the verdict lowers it. */
  readonly configured: string
  readonly record: ModelCapabilityRecord | undefined
  readonly policyLevels: PolicyEffortScale
}

/** The text a replay input item carries, for the keep-list ranking. */
function inputItemText(item: InputItem): string | undefined {
  if (item.type === 'message') {
    const texts: string[] = []
    for (const part of item.content) {
      if (part.type === 'input_text') texts.push(part.text)
    }
    return texts.length === 0 ? undefined : texts.join('\n')
  }
  return item.type === 'function_call_output' && typeof item.output === 'string'
    ? item.output
    : undefined
}

/**
One session's fast judge. The loop signals cover the current turn only
(a turn boundary starts a new episode); the tail queue drains into the
next request; the triage tallies feed the Judge section's no-window share
(lane U).
*/
export class ModelApiFastJudge {
  private triageMiss = 0
  private triageNoWindow = 0
  /** The turn boundary: the next request's start closes the turn before it. */
  private readonly turns: FastTurnBoundary

  constructor(private readonly host: FastJudgeHost) {
    this.turns = new FastTurnBoundary({
      backend: 'modelApi',
      pin: host.pin,
      isOff: host.isOff,
      read: host.read,
      emit: host.emit,
    })
  }

  /** A request starts: the turn before it closes, once. */
  start(turnId: string | undefined): void {
    this.turns.start(turnId)
  }

  /** The turn ends: its record closes, once. */
  end(turnId: string): void {
    this.turns.end(turnId)
  }

  /**
  The queued tail notes, drained: one developer message each, after
  everything already sent. Empty with the switch off or every decision
  abstaining: the input then keeps today's bytes.
  */
  drainTail(): FastTailNote[] {
    return tailNotes(this.turns.tail.splice(0))
  }

  /**
  D107 §6.3 and §6.2: one settled tool result through the loop detector
  and the first-send triage. A loop queues its note for the next
  request's tail, once per episode — the turn is never stopped (D121),
  and a repeat also carries the repeat guard's own notice. A skipped
  output packs through M73's own placeholder; anything else rides whole
  as today, and a miss tallies for the Judge section's no-window share.
  */
  observeResult(
    call: { readonly name: string; readonly arguments: string; readonly call_id: string },
    output: string,
    exitCode: number | undefined,
    hasFailed: boolean,
    isParallel: boolean,
  ): void {
    if (this.host.isOff()) return
    const turns = this.turns
    turns.loop.push({
      key: toolRepeatKey(call),
      failed: hasFailed,
      outputDigest: fingerprint(output),
    })
    const loop = detectLoop(turns.loop)
    const loopPin = this.host.pin('loop.stuck')
    const isLoopRaised = loop.stuck || loopPin === true
    const isLoopActed = isLoopRaised && !turns.stuck && loopPin !== false
    if (isLoopActed) {
      turns.tail.push(loopTailNote(loop.stuck ? loop.pattern : 'repeat', call.name))
      if (loop.stuck && loop.pattern === 'repeat') {
        const last = turns.loop.at(-1)
        let run = 0
        if (last !== undefined) {
          for (const signal of turns.loop.toReversed()) {
            if (signal.key !== last.key || signal.outputDigest !== last.outputDigest) break
            run += 1
          }
        }
        this.host.noteRepeating(call.name, run)
      }
    }
    turns.stuck = isLoopRaised
    turns.recorder.observeLoop(isLoopRaised, isLoopActed, loopTurnReason(loop, loopPin))
    // A parallel call settles while its round's other calls ran
    // alongside, so the decision may still land before the next
    // request; a lone result has no window.
    const route = triageRoute(
      triageOutput({ exitCode, output }),
      isParallel ? 'real' : 'none',
      false,
    )
    const triagePin = this.host.pin('triage.needFull')
    const isTriagePack = route.action === 'pack'
    const isTriageActed = triagePin !== false && (isTriagePack || triagePin === true)
    if (isTriageActed) this.host.markEarly(call.call_id)
    else if (
      triagePin === undefined &&
      route.action === 'whole' &&
      route.unasked !== 'recognised'
    ) {
      this.triageMiss += 1
      if (route.unasked === 'no-window') this.triageNoWindow += 1
    }
    turns.recorder.observeTriage(
      isTriagePack || triagePin === true,
      isTriageActed,
      triageTurnReason(route, triagePin),
    )
  }

  /**
  D107 §6.6: this request's effort, asked inside a turn with the switch
  on. A narrowly mechanical request on a few touched files runs one level
  below the configured effort on the model's own scale; anything else
  sends the configured level, byte for byte as today.
  */
  effort(request: FastEffortRequest): string {
    const files = request.replay.filter(
      (entry) =>
        entry.turnId === request.turnId &&
        entry.item.type === 'function_call' &&
        (entry.item.name === MODEL_API_TOOLS.writeFile ||
          entry.item.name === MODEL_API_TOOLS.editFile),
    ).length
    const verdict = ruleEffort({ request: request.request, filesTouched: files })
    const pin = this.host.pin('effort.lower')
    const isLower = verdict.decision === 'lower'
    // D107 §4.1 (lane P): the model's own record wins when its lane
    // carried one; without a record the policy keeps today's behaviour.
    const lowered = lowerEffortLevel(
      request.configured,
      fastEffortScale(request.record, request.policyLevels),
    )
    const isWant = pin ?? isLower
    const isActed = isWant && lowered !== request.configured
    this.turns.recorder.observeEffort(
      isLower || pin === true,
      isActed,
      effortTurnReason(isLower, isActed, lowered !== request.configured),
    )
    return isActed ? lowered : request.configured
  }

  /**
  D107 §6.1: what a compaction keeps past its tail: the replay entries the
  request's text ranks most relevant, most relevant first, up to the keep
  bound. Empty with the switch off, with no request yet, or on a miss —
  the tail then keeps exactly as today. Nothing already sent is removed
  or reordered.
  */
  keepForCompaction<T extends FastReplayEntry>(
    kept: readonly T[],
    replay: readonly T[],
    request: string,
  ): T[] {
    if (this.host.isOff()) return []
    const pin = this.host.pin('context.include')
    const isRequestEmpty = request.trim().length === 0
    if (isRequestEmpty && pin !== true) {
      this.turns.recorder.observeKeep(false, false, 'empty')
      return []
    }
    const held = new Set(kept)
    const candidates: { readonly id: string; readonly text: string }[] = []
    for (const [index, entry] of replay.entries()) {
      if (held.has(entry)) continue
      const text = inputItemText(entry.item)
      if (text !== undefined && text.trim().length > 0) candidates.push({ id: String(index), text })
    }
    if (pin === false) {
      this.turns.recorder.observeKeep(candidates.length > 0, false, 'pinned')
      return []
    }
    const ids = new Set(rankedKeepIds(request, candidates).slice(0, JUDGE_FAST_KEEP_ENTRIES))
    const keptEntries: T[] = []
    for (const [index, entry] of replay.entries()) {
      if (ids.has(String(index))) keptEntries.push(entry)
    }
    this.turns.recorder.observeKeep(
      candidates.length > 0 || pin === true,
      keptEntries.length > 0,
      keepTurnReason(keptEntries.length > 0, isRequestEmpty),
    )
    return keptEntries
  }
}
