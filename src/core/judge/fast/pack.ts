// M125 lane E (D107): batching per state within the packer's bounds.
// Questions split across batches, never the state: every batch names
// the one state its questions judge. A question that fits no batch
// even alone is reported as oversized — the caller refuses it as
// over-context — never silently dropped. Pure and synchronous.
export interface PackableQuestion {
  readonly id: string
  /** The question's wire bytes as the caller measured them. */
  readonly bytes: number
}

export interface PackableState {
  readonly stateId: string
  readonly questions: readonly PackableQuestion[]
}

export interface PackedBatch {
  readonly stateId: string
  readonly questions: readonly PackableQuestion[]
}

export interface PackedQuestions {
  readonly batches: readonly PackedBatch[]
  /** Questions larger than the whole batch budget, refused as over-context. */
  readonly oversized: readonly PackableQuestion[]
}

/** Batch each state's questions within the byte and count bounds. */
export function packByState(
  states: readonly PackableState[],
  maxBytes: number,
  maxQuestions: number,
): PackedQuestions {
  const batches: PackedBatch[] = []
  const oversized: PackableQuestion[] = []
  for (const state of states) {
    let open: PackableQuestion[] = []
    let openBytes = 0
    const flush = (): void => {
      if (open.length > 0) batches.push({ stateId: state.stateId, questions: open })
      open = []
      openBytes = 0
    }
    for (const question of state.questions) {
      if (question.bytes > maxBytes || maxQuestions < 1) {
        oversized.push(question)
        continue
      }
      if (open.length >= maxQuestions || openBytes + question.bytes > maxBytes) flush()
      open.push(question)
      openBytes += question.bytes
    }
    flush()
  }
  return { batches, oversized }
}
