// Production legalScan.js entry: local reads only, shared by both loaders.
import { SETTING_DEFAULTS } from '../../shared/constants'
import { legalScanInputSchema } from '../../shared/legal'
import type {
  LegalScanRequest,
  LegalScanHandle,
  LegalRegistryTarget,
} from '../../shared/legalScanEntry'
import { readNpm } from './ecosystems/npm'
import { readPython } from './ecosystems/python'
import { scanLegal } from './scan'
import { createLegalSnapshot } from './workspace'

export function runLegalScan(request: LegalScanRequest): Promise<LegalScanHandle> {
  request.signal?.throwIfAborted()
  const input = legalScanInputSchema.parse(request.input)
  const snapshot = createLegalSnapshot(request.workspaceRoot, request.signal)
  const result = scanLegal(snapshot, {
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
  request.signal?.throwIfAborted()
  return Promise.resolve({ result, registryTargets })
}
