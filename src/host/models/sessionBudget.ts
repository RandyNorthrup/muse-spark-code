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
import { fill, formatUsd } from '../../shared/l10n/text'
import type { Logger } from '../logger'

/** Where the conversation spending limit is effective from. */
export type SessionBudgetScope = 'workspace' | 'global'

/**
 * The narrow configuration surface the wizard's budget write needs. The
 * production adapter in `modelsPanelEntry.ts` backs it with VS Code's
 * configuration; tests back it with memory.
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
    write: (value, scope) => source.update(SESSION_BUDGET_SETTING, value, scope),
  }
}

export type SessionBudgetApplyOutcome =
  | { readonly status: 'unchanged' }
  | { readonly status: 'written'; readonly scope: SessionBudgetScope }
  | { readonly status: 'failed'; readonly error: string }

function failureDetail(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : UI_TEXT.actionFailed
}

/**
 * Applies the wizard's budget to the conversation spending limit setting.
 * `undefined` (untouched) and a value equal to the effective one write
 * nothing. Anything else is validated with the setting's own schema and
 * written at the scope it is effective from; a failed write reports the
 * specific reason and the caller must not report setup success.
 */
export async function applyWizardSessionBudget(
  budget: UsdAmount | undefined,
  config: SessionBudgetConfig,
): Promise<SessionBudgetApplyOutcome> {
  if (budget === undefined) {
    return { status: 'unchanged' }
  }
  // The setting's own schema: non-negative exact-decimal USD, as elsewhere.
  const parsed = legacyUsdSchema.safeParse(budget)
  if (!parsed.success) {
    return { status: 'failed', error: UI_TEXT.wizardSessionBudgetInvalid }
  }
  const current = config.read()
  if (Usd.from(parsed.data).compare(Usd.from(current.effectiveUsd)) === 0) {
    return { status: 'unchanged' }
  }
  try {
    await config.write(parsed.data, current.scope)
  } catch (error) {
    return {
      status: 'failed',
      error: fill(UI_TEXT.sessionBudgetWriteFailed, { detail: failureDetail(error) }),
    }
  }
  // The write resolved but the setting still reads the old value (a more
  // specific scope still wins): say so instead of reporting success.
  const reread = config.read().effectiveUsd
  if (Usd.from(reread).compare(Usd.from(parsed.data)) !== 0) {
    return {
      status: 'failed',
      error: fill(UI_TEXT.sessionBudgetWriteFailed, {
        detail: fill(UI_TEXT.sessionBudgetStillEffective, { amount: formatUsd(reread) }),
      }),
    }
  }
  return { status: 'written', scope: current.scope }
}
