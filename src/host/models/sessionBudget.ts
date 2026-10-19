import { Usd, legacyUsdSchema, type UsdAmount } from '../../shared/usd'
// The wizard's spending limit IS the conversation spending limit setting
// (`museSpark.modelApiSessionBudgetUsd`, enforced per request by the
// session-budget admission): both save paths (the panel and the quick
// pick) write through this one function, so the accepted number always
// reaches the cap enforcement reads. Never a hidden per-wizard cap, never
// a silent overwrite: an unchanged value writes nothing, and a changed one
// is written at the scope it is effective from today.
//
// This reads only its one key with the setting's own schema (the full
// settings reader lives in `host/settings.ts`, which this lazy bundle must
// not carry: it would drag every schema into `dist/modelsPanel.js`).

import { SETTING_DEFAULTS, UI_TEXT } from '../../shared/constants'
import { fill } from '../../shared/l10n/text'
import { formatUsd } from '../../shared/l10n/exactUsd'
import type { Logger } from '../logger'

/** Where the conversation spending limit is effective from. */
export type SessionBudgetScope = 'workspace' | 'global'

/**
The narrow configuration surface the wizard's budget write needs. The
production adapter in `modelsPanelEntry.ts` backs it with VS Code's
configuration; tests back it with memory.
*/
export interface SessionBudgetConfigSource {
  get(section: string): unknown
  inspect(section: string): { workspaceValue?: unknown; workspaceFolderValue?: unknown } | undefined
  update(section: string, value: unknown, scope: SessionBudgetScope): Promise<void>
}

/** The setting as enforcement reads it today, and where it comes from. */
export interface SessionBudgetState {
  readonly effectiveUsd: UsdAmount
  readonly scope: SessionBudgetScope
}

export interface SessionBudgetConfig {
  read(): SessionBudgetState
  /**
   * Throws `SessionBudgetInvalidError` for an invalid value; anything else
   * it throws is the store's failure and reaches the caller with its cause.
   */
  write(value: UsdAmount, scope: SessionBudgetScope): Promise<void>
}

const SESSION_BUDGET_SETTING = 'modelApiSessionBudgetUsd'

export function createSessionBudgetConfig(
  source: SessionBudgetConfigSource,
  log: Logger,
): SessionBudgetConfig {
  let hasWarned = false
  const readEffective = (): UsdAmount => {
    const parsed = legacyUsdSchema.safeParse(source.get(SESSION_BUDGET_SETTING))
    if (parsed.success) {
      return parsed.data
    }
    // One bad value cannot take the panel down: the documented default
    // stands in, as the settings reader does for every key.
    if (!hasWarned) {
      hasWarned = true
      log.warn(
        `Setting museSpark.${SESSION_BUDGET_SETTING} is invalid and its default is in effect`,
      )
    }
    return Usd.from(SETTING_DEFAULTS.modelApiSessionBudgetUsd).toAmount()
  }
  return {
    read: () => {
      const inspected = source.inspect(SESSION_BUDGET_SETTING)
      // An existing workspace value stays a workspace value; a global one
      // stays global. The write below never moves the value's scope.
      const scope: SessionBudgetScope =
        inspected?.workspaceValue !== undefined || inspected?.workspaceFolderValue !== undefined
          ? 'workspace'
          : 'global'
      return {
        effectiveUsd: readEffective(),
        scope,
      }
    },
    write: async (value, scope) => {
      // The contributed setting is a non-negative number. Preserve the
      // exact decimal on this boundary: refuse overflow or rounding rather
      // than store an invalid type or a different spending limit.
      const numeric = Number(value)
      const parsed = legacyUsdSchema.safeParse(numeric)
      if (!parsed.success || Usd.from(parsed.data).compare(Usd.from(value)) !== 0) {
        throw new SessionBudgetInvalidError()
      }
      await source.update(SESSION_BUDGET_SETTING, numeric, scope)
    },
  }
}

export type SessionBudgetApplyOutcome =
  | { readonly status: 'unchanged' }
  | { readonly status: 'written'; readonly scope: SessionBudgetScope }
  | { readonly status: 'conflict'; readonly effectiveUsd: UsdAmount; readonly error: string }
  | { readonly status: 'failed'; readonly error: string }

/**
 * The budget value itself is invalid (the setting's own schema refused
 * it). Anything else a write throws is the store's failure, which still
 * throws so the saver reports it with its cause.
 */
export class SessionBudgetInvalidError extends Error {
  public constructor() {
    super(UI_TEXT.wizardSessionBudgetInvalid)
    this.name = 'SessionBudgetInvalidError'
  }
}

/** Validate an edited setting before any provider or credential write. */
export function validateWizardSessionBudget(
  budget: UsdAmount | undefined,
  expectedUsd: UsdAmount | undefined,
): string | undefined {
  if (budget === undefined) return undefined
  const numeric = Number(budget)
  const parsed = legacyUsdSchema.safeParse(numeric)
  return expectedUsd === undefined ||
    !parsed.success ||
    Usd.from(parsed.data).compare(Usd.from(budget)) !== 0
    ? UI_TEXT.wizardSessionBudgetInvalid
    : undefined
}

/**
Applies the wizard's budget to the conversation spending limit setting.
`undefined` (untouched) and a value equal to the effective one write
nothing. Anything else is validated with the setting's own schema and
written at the scope it is effective from; a failed write reports the
specific reason. Call only after provider save succeeds. A concurrent
setting change requires explicit confirmation before replacing it.
*/
export async function applyWizardSessionBudget(
  budget: UsdAmount | undefined,
  config: SessionBudgetConfig,
  expectedUsd: UsdAmount | undefined,
): Promise<SessionBudgetApplyOutcome> {
  if (budget === undefined) {
    return { status: 'unchanged' }
  }
  // The setting's own schema: non-negative exact-decimal USD, as elsewhere.
  const parsed = legacyUsdSchema.safeParse(budget)
  if (!parsed.success) {
    return { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid }
  }
  if (expectedUsd === undefined) {
    return { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid }
  }
  const current = config.read()
  if (Usd.from(parsed.data).compare(Usd.from(current.effectiveUsd)) === 0) {
    return { status: 'unchanged' }
  }
  // Read and compare immediately before dispatching the settings write;
  // the provider transaction has already completed, so changes during it
  // cannot be overwritten with the wizard's old prefill.
  if (Usd.from(expectedUsd).compare(Usd.from(current.effectiveUsd)) !== 0) {
    return {
      status: 'conflict',
      effectiveUsd: current.effectiveUsd,
      error: fill(UI_TEXT.sessionBudgetConflict, {
        amount: formatUsd(current.effectiveUsd),
        requested: formatUsd(parsed.data),
      }),
    }
  }
  try {
    await config.write(parsed.data, current.scope)
  } catch (error: unknown) {
    if (error instanceof SessionBudgetInvalidError) {
      return { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid }
    }
    throw error
  }
  // The write resolved but the setting still reads the old value (a more
  // specific scope still wins): say so instead of reporting success.
  const reread = config.read().effectiveUsd
  if (Usd.from(reread).compare(Usd.from(parsed.data)) !== 0) {
    return {
      status: 'failed',
      error: fill(UI_TEXT.sessionBudgetStillEffective, { amount: formatUsd(reread) }),
    }
  }
  return { status: 'written', scope: current.scope }
}
