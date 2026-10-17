import { Buffer } from 'node:buffer'

export interface MergeVersion {
  readonly bytes: Buffer
  readonly mode: '100644' | '100755' | '120000'
}

export interface MergeFileInput {
  readonly path: string
  readonly kind: 'text' | 'json-table' | 'changelog'
  readonly base: MergeVersion | null
  readonly ours: MergeVersion | null
  readonly theirs: MergeVersion | null
}

export type MergeFileResult =
  | { readonly status: 'clean'; readonly file: MergeVersion | null }
  | { readonly status: 'conflict'; readonly markers: MergeVersion | null }
  | { readonly status: 'refused'; readonly reason: string }

/** Lane C supplies the strict structured merges; no text fallback is possible. */
export interface MergeRoutineDeps {
  readonly jsonTable: (input: MergeFileInput) => Promise<MergeFileResult>
  readonly changelog: (input: MergeFileInput) => Promise<MergeFileResult>
  readonly text: (
    base: Buffer,
    ours: Buffer,
    theirs: Buffer,
  ) => Promise<{ readonly bytes: Buffer; readonly conflicts: boolean }>
}

function isEqual(left: MergeVersion | null, right: MergeVersion | null): boolean {
  return left === null || right === null
    ? left === right
    : left.mode === right.mode && left.bytes.equals(right.bytes)
}

function isText(file: MergeVersion): boolean {
  if (file.mode === '120000' || file.bytes.includes(0)) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(file.bytes)
    return true
  } catch {
    return false
  }
}

/** Prediction and landing use this same dispatch and explicit file rules. */
export async function mergeFile(
  input: MergeFileInput,
  deps: MergeRoutineDeps,
): Promise<MergeFileResult> {
  // Structured files must validate even when one side is unchanged.
  if (input.kind === 'json-table') return await deps.jsonTable(input)
  if (input.kind === 'changelog') return await deps.changelog(input)
  const { base, ours, theirs } = input
  if (isEqual(ours, theirs) || isEqual(base, theirs)) return { status: 'clean', file: ours }
  if (isEqual(base, ours)) return { status: 'clean', file: theirs }
  if (ours === null || theirs === null) return { status: 'conflict', markers: null }
  if ([ours, theirs, ...(base === null ? [] : [base])].some((file) => !isText(file))) {
    return { status: 'conflict', markers: null }
  }
  if (ours.mode !== theirs.mode && ours.mode !== base?.mode && theirs.mode !== base?.mode) {
    return { status: 'conflict', markers: null }
  }
  const mode = ours.mode === base?.mode ? theirs.mode : ours.mode
  const merged = await deps.text(base?.bytes ?? Buffer.alloc(0), ours.bytes, theirs.bytes)
  const file: MergeVersion = { bytes: merged.bytes, mode }
  return merged.conflicts ? { status: 'conflict', markers: file } : { status: 'clean', file }
}
