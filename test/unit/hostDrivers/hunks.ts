// The native conformance diff-hunks leg (RLF-M104GL): settles the contract
// scenario's second hunk through the production edit review and reports the
// decision record with the resulting text. The native side applies the
// forward edit and saves it through its own documents; this driver runs the
// revert half, which lives in the runtime. Native harnesses spawn this
// through runDriver.mjs, which bundles it with esbuild; the unit suite
// imports it directly.
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { EditReview } from '../../../src/host/editor/editReview'
import { createRevertIo } from '../../../src/host/editor/revertIo'
import type { Logger } from '../../../src/host/logger'
import { headlessToolIo } from '../helpers/headlessToolIo'
import { reviewDriverBase, scenarioDiffPatchJson } from '../helpers/reviewDriver'

export interface HunksDriverArgs {
  readonly workspaceRoot: string
}

export interface HunksDriverResult {
  readonly hunks: { readonly one: 'accept'; readonly two: 'reject' }
  readonly text: string
}

function neverCalled(name: string): never {
  throw new Error(`${name} is never called on the hunk path`)
}

export async function runHunksDriver(
  args: HunksDriverArgs,
  log: Logger,
): Promise<HunksDriverResult> {
  const toolIo = headlessToolIo(args.workspaceRoot)
  const review = new EditReview({
    ...reviewDriverBase(toolIo, args.workspaceRoot),
    io: createRevertIo({
      io: toolIo,
      platform: process.platform,
      // A hunk revert in an existing file never trashes: only a created
      // file's whole revert deletes, and the scenario settles one hunk.
      trash: () => neverCalled('trash'),
    }),
    // Settling a hunk writes; it never opens a diff editor.
    openDiff: () => neverCalled('openDiff'),
    log,
  })
  // Accept hunk one by leaving it; reject hunk two by reverting it.
  const rejected = await review.revertHunk('m104gl-diff-hunks', scenarioDiffPatchJson(), 0, 1)
  if (!rejected.isReverted) throw new Error('the second hunk was not reverted')
  const text = readFileSync(path.join(args.workspaceRoot, 'lines.txt'), 'utf8')
  return { hunks: { one: 'accept', two: 'reject' }, text }
}
