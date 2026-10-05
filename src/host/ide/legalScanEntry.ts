// The shared lazy scanner entry (M97, D6). Host tools and the deterministic
// runtime command pass their workspace explicitly; no backend or auth starts.
import { scheduler } from 'node:timers/promises'
import { createLegalSnapshot, scanLegal } from '../../core/legal'
import { readNpm } from '../../core/legal/ecosystems/npm'
import { readPython } from '../../core/legal/ecosystems/python'
import { PlanModeHold, type PlanModeHoldDeps } from '../../core/review/planModeHold'
import { LEGAL_FINDINGS_MAX, SETTING_DEFAULTS } from '../../shared/constants'
import { legalScanInputSchema, type LegalScanInput } from '../../shared/legal'
import { setUiText } from '../../shared/l10n/text'
import type { UiText } from '../../shared/l10n/en'
import type { LegalScanHandle } from '../../runtime/legal/legalScanner'

/** The caller installs its display language before the lazy code runs. */
export async function runLegalScan(request: {
  readonly workspaceRoot: string
  readonly input: LegalScanInput
  readonly signal?: AbortSignal
  readonly uiText?: UiText
  readonly uiLocale?: string
}): Promise<LegalScanHandle> {
  request.signal?.throwIfAborted()
  const input = legalScanInputSchema.parse(request.input)
  if (request.uiText !== undefined && request.uiLocale !== undefined)
    setUiText(request.uiText, request.uiLocale)
  const snapshot = createLegalSnapshot(request.workspaceRoot, request.signal)
  const result = scanLegal(snapshot, {
    headerPolicy: input.headerPolicy ?? SETTING_DEFAULTS.legalHeaderPolicy,
    ...(input.paths !== undefined && { paths: input.paths }),
    ...(request.signal !== undefined && { signal: request.signal }),
  })
  const dependencies = [...readNpm(snapshot).dependencies, ...readPython(snapshot).dependencies]
  const registryTargets: LegalScanHandle['registryTargets'][number][] = []
  for (const dependency of dependencies.slice(0, LEGAL_FINDINGS_MAX)) {
    if (dependency.licenseRaw !== undefined || dependency.version === undefined) continue
    const ecosystem = dependency.ecosystem === 'pip' ? 'pypi' : dependency.ecosystem
    if (ecosystem !== 'npm' && ecosystem !== 'pypi') continue
    registryTargets.push({ ecosystem, name: dependency.name, version: dependency.version })
  }
  // Let a queued stop/disposal run before any report leaves this bundle.
  await scheduler.yield()
  request.signal?.throwIfAborted()
  return { result, registryTargets }
}

/** A live conversation reuses the existing review hold; scan never opens one. */
export function createHold(deps: PlanModeHoldDeps): PlanModeHold {
  return new PlanModeHold(deps)
}
