// Shared estimate grammar only; browser consumers never carry unrelated CLI options.
export const ESTIMATE_OPTIONS = {
  by: { type: 'string' },
  fleet: { type: 'string' },
  format: { type: 'string' },
  seed: { type: 'string' },
  'check-plan': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
} as const
