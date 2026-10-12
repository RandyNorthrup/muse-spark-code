// Types for scripts/build-confine.mjs's internal F1a helper build, which the
// capture command and its unit test import to build a helper on demand.
export function buildConfine(directory: string): Promise<string>
