// The eager half of `/estimate` dispatch (M117, PLAN.md D97): recognize the
// command from the draft's first word without loading the composer's zod
// schemas. The boundary MUST match `estimateSlashArguments` in
// `src/runtime/estimator/command.ts` (`/^\/estimate(?:\s+([\s\S]*))?$/` on
// trimmed text): bare `/estimate` or `/estimate` plus whitespace. Anything
// else (`/estimateX`) is not an estimate and keeps its normal dispatch.
// `estimateCommand.test.ts` ("prefix parity") fails if the two ever disagree.
export function isEstimateCommandText(text: string): boolean {
  return text === '/estimate' || /^\/estimate\s/.test(text)
}
