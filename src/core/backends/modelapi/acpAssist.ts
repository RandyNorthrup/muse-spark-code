// The Model API backend's ACP-assist bundle (PLAN.md D6): the settled-cost
// tally the ACP answer carries (read only by the ACP translator), the
// translated workspace-refusal wording, and the rare alias-glob fallback.
// esbuild builds modelApiAcpEntry.ts into dist/modelApiAcp.js; the backend's
// own modules import the entry's names, which the build externalises to a
// require of the sibling bundle, so the backend stays lean and the moved
// paths stay plain calls. Every name read across the boundary is exported by
// the entry; nothing thrown here crosses it (all results are values).

import path from 'node:path'
import { fill } from '../../../shared/l10n/text'
import { MODEL_API_MODEL_TEXT, UI_TEXT } from '../../../shared/constants'
import { sumUsd, Usd, type UsdAmount } from '../../../shared/usd'
import type { ModelPricing } from '../../providers/priceCard'
import type { Usage } from './schemas'
import type { ToolContext, ToolOutcome } from './tools'
import { isBelow, resolveWorkspacePath, type RealPathIo } from '../../workspacePath'

/** The fixed clause a confinement reason carries when a link escape was refused. */
const LINK_ESCAPE_CLAUSE = 'leads outside the workspace through a link'

/**
 * Whether a confinement refusal names a link/junction escape: the
 * client-facing wording names the escape, while other refusals use the
 * plain outside wording. The clause is model-facing English, stable across
 * installed languages.
 */
function isLinkEscapeRefusal(reason: string): boolean {
  return reason.includes(LINK_ESCAPE_CLAUSE)
}

export function pathRefusal(
  refusal: {
    readonly reason: string
    readonly code?: 'outside_workspace'
  },
  /** The path or search pattern as given, named in the translated reason. */
  given: string | undefined,
): ToolOutcome {
  if (refusal.code !== 'outside_workspace') return failure(refusal.reason)
  // What the person reads is translated text with its own keys: the
  // model-facing detail keeps the English reason. The translator copies
  // failureReason into the client's refusal reason.
  const reason = fill(
    isLinkEscapeRefusal(refusal.reason)
      ? UI_TEXT.acpRefusalLinkEscape
      : UI_TEXT.acpRefusalOutsideWorkspace,
    { path: given ?? '' },
  )
  return {
    output: JSON.stringify({
      error: {
        code: refusal.code,
        message: MODEL_API_MODEL_TEXT.outsideWorkspaceRefused,
        detail: refusal.reason,
      },
    }),
    visibleOutput: UI_TEXT.acpOutsideWorkspaceRefused,
    failureReason: reason,
    refusalCode: refusal.code,
  }
}

function failure(reason: string, visibleReason = reason): ToolOutcome {
  return { output: `Error: ${reason}`, visibleOutput: visibleReason, failureReason: visibleReason }
}

const GLOB_MAGIC = /[*?[\]{}]/u

export async function confinedGlob(
  glob: string | undefined,
  context: ToolContext,
): Promise<
  | { readonly ok: true; readonly glob: string | undefined }
  | { readonly ok: false; readonly reason: string; readonly code?: 'outside_workspace' }
> {
  if (glob === undefined) return { ok: true, glob }
  // The same spelling rules a plain path meets: verbatim prefixes, device
  // names and escapes are judged once, in `workspacePath`.
  const resolved = resolveWorkspacePath(context.workspaceRoot, glob, context.platform)
  if (resolved.ok) return { ok: true, glob: resolved.relative }
  if (resolved.code !== 'outside_workspace') return resolved
  // An alias spelling (a Windows 8.3 short name) is inside by resolved
  // identity: the pattern is rewritten onto the real folder on this failure
  // path only, so the lexical check above stays lean.
  return (
    (await resolveGlobAlias(glob, context.workspaceRoot, context.platform, context.io)) ?? resolved
  )
}

/**
 * The alias-glob fallback for a search pattern the spelling rules refused:
 * a Windows 8.3 short name (or another alias spelling) is inside by resolved
 * identity, so the non-magic prefix is resolved to the real folder and the
 * pattern rewritten onto it. Returns undefined when the pattern stays
 * refused and the caller keeps its spelling refusal.
 */
async function resolveGlobAlias(
  glob: string,
  workspaceRoot: string,
  platform: NodeJS.Platform,
  io: RealPathIo,
): Promise<{ readonly ok: true; readonly glob: string | undefined } | undefined> {
  // A missing base can only resolve inside when the spelling was already
  // inside, which never reaches this fallback: `resolve` normalises `..`
  // first.
  try {
    const p = platform === 'win32' ? path.win32 : path.posix
    const parts = glob.replaceAll('\\', '/').split('/')
    const magic = parts.findIndex((part) => GLOB_MAGIC.test(part))
    const base = (magic === -1 ? parts : parts.slice(0, magic)).join('/')
    const rest = magic === -1 ? '' : parts.slice(magic).join('/')
    // An absolute base names itself; a relative one resolves against the
    // root (splitting an absolute base and re-resolving its parts would
    // silently re-root it under the workspace).
    const baseAbsolute = p.isAbsolute(base)
      ? p.normalize(base)
      : p.resolve(workspaceRoot, ...base.split('/'))
    const [realRoot, realBase] = await Promise.all([
      io.realPath(workspaceRoot),
      base === '' ? io.realPath(workspaceRoot) : io.realPath(baseAbsolute),
    ])
    const relative = p.relative(realRoot, realBase)
    if (relative !== '' && !isBelow(relative, p)) return undefined
    const rewritten = relative === '' ? rest : `${relative.split(p.sep).join('/')}/${rest}`
    return { ok: true, glob: rewritten === '' ? undefined : rewritten }
  } catch {
    return undefined
  }
}

/**
 * The settled dollars behind a session's `tokenUsage` totals, owned by the
 * assist bundle: the host holds one per session and never reads its fields.
 */
export interface CostTally {
  cost: UsdAmount
  certainty: 'reported' | 'computed' | undefined
}

export function newTally(): CostTally {
  return { cost: Usd.from(0).toAmount(), certainty: 'reported' }
}

/**
 * One source for cost: the settled dollars behind the answer's token totals,
 * each request priced at the model actually billed. Local, plan and ambiguous
 * requests have no displayable price, exactly as the usage record marks them
 * (both settle a defined zero); while any of it is unpriced the tally hides
 * rather than showing a partial sum.
 */
export function settleCost(
  tally: CostTally,
  usage: Usage,
  /** The usage record's settlement at the sent model, if it priced the request. */
  settled: UsdAmount | undefined,
  model: {
    readonly policy: { readonly pricing: { readonly kind: ModelPricing['kind'] } }
  },
  hasAmbiguousCallAttempt: boolean,
): void {
  const providerCostUsd = usage.provider_cost_usd
  const pricingKind = model.policy.pricing.kind
  let requestCertainty: 'reported' | 'computed' | undefined
  if (providerCostUsd !== undefined) {
    requestCertainty = 'reported'
  } else if (
    settled === undefined ||
    pricingKind === 'local' ||
    pricingKind === 'plan' ||
    hasAmbiguousCallAttempt
  ) {
    requestCertainty = undefined
  } else {
    requestCertainty = 'computed'
  }
  if (requestCertainty === undefined) {
    tally.certainty = undefined
    return
  }
  if (settled !== undefined) tally.cost = sumUsd(tally.cost, settled)
  if (requestCertainty === 'computed' && tally.certainty !== undefined) tally.certainty = 'computed'
}

/**
 * A child's settled dollars join the answer tally at the child's own models,
 * never repriced here. A child with no displayable price hides the tally, as
 * its tokens do. Returns the child's new folded mark, so each settlement is
 * counted once.
 */
export function foldChildCost(parent: CostTally, child: CostTally, mark: UsdAmount): UsdAmount {
  if (child.certainty === undefined) {
    parent.certainty = undefined
    return child.cost
  }
  const settledDelta = Usd.from(child.cost).subtract(Usd.from(mark))
  if (settledDelta.compare(Usd.from(0)) > 0)
    parent.cost = sumUsd(parent.cost, settledDelta.toAmount())
  if (child.certainty === 'computed' && parent.certainty !== undefined)
    parent.certainty = 'computed'
  return child.cost
}

/** The tally as the `tokenUsage` event carries it: absent while any of it is unpriced. */
export function costField(
  tally: CostTally,
):
  | Record<string, never>
  | { readonly cost: { readonly usd: number; readonly certainty: 'reported' | 'computed' } } {
  return tally.certainty === undefined
    ? {}
    : { cost: { usd: Number(tally.cost), certainty: tally.certainty } }
}
