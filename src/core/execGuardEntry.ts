// dist/execGuard.js, required on the first guarded process start: the
// guarded process-start layer (PLAN.md D24) beside activation, so the
// activation bundle carries none of it. Only this entry re-exports the
// layer, and the split gate pins its files to this bundle.
export * from './execGuard'
