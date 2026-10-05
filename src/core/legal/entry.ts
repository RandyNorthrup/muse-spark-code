// Production legalScan.js entry: local reads only, shared by both loaders.
import { LEGAL_SCAN_TIMEOUT_MS, SETTING_DEFAULTS } from '../../shared/constants'
import { legalScanInputSchema } from '../../shared/legal'
import type {
  LegalScanRequest,
  LegalScanHandle,
  LegalRegistryTarget,
} from '../../shared/legalScanEntry'
import type { LegalFinding } from '../../shared/legal'
import type { LegalPreparedPatch } from '../../shared/legalScanEntry'
import { prepareLegalHeaderPatches } from './headerFix'
import { readNpm } from './ecosystems/npm'
import { readPython } from './ecosystems/python'
import { scanLegal } from './scan'
import { createLegalSnapshot } from './workspace'

export async function runLegalScan(request: LegalScanRequest): Promise<LegalScanHandle> {
  request.signal?.throwIfAborted()
  const input = legalScanInputSchema.parse(request.input)
  const deadline = Date.now() + LEGAL_SCAN_TIMEOUT_MS
  const snapshot = createLegalSnapshot(request.workspaceRoot, request.signal, deadline)
  const result = scanLegal(snapshot, {
    deadline,
    ...(input.paths !== undefined && { paths: input.paths }),
    headerPolicy: input.headerPolicy ?? SETTING_DEFAULTS.legalHeaderPolicy,
    ...(request.signal !== undefined && { signal: request.signal }),
  })
  const registryTargets: LegalRegistryTarget[] = []
  for (const reader of [readNpm, readPython]) {
    for (const dependency of reader(snapshot).dependencies) {
      if (
        (dependency.ecosystem === 'npm' || dependency.ecosystem === 'pip') &&
        dependency.licenseRaw === undefined &&
        dependency.version !== undefined
      ) {
        registryTargets.push({
          ecosystem: dependency.ecosystem === 'pip' ? 'pypi' : 'npm',
          name: dependency.name,
          version: dependency.version,
        })
      }
    }
  }
  // Let pending Stop messages run before final report admission.
  await new Promise<void>((resolve) => {
    setImmediate(resolve)
  })
  request.signal?.throwIfAborted()
  return { result, registryTargets }
}

export function prepareLegalFixes(
  workspaceRoot: string,
  findings: readonly LegalFinding[],
): Promise<readonly LegalPreparedPatch[]> {
  return Promise.resolve(prepareLegalHeaderPatches(createLegalSnapshot(workspaceRoot), findings))
}

export { renderLegalMarkdown } from './markdown'
export { setUiText as setLanguage } from '../../shared/l10n/text'
