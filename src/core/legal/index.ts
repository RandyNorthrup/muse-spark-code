// Public scanner API; runtime and host integration load this entry lazily.
export { scanLegal, LEGAL_SCANNER_RULE_VERSION, type LegalScanOptions } from './scan'
export { createLegalSnapshot, type LegalWorkspaceSnapshot } from './workspace'
export { LegalScanError, type LegalFileSnapshot } from './files'
export { SPDX_DATA_VERSION, spdxProvenance } from './data'
