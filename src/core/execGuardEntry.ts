// dist/execGuard.js, required when the extension module is evaluated
// (the extension's static import builds to a top-level require of the
// external file, even when no process starts; a missing file fails
// extension load instead of starting an unguarded process): the
// guarded process-start layer (PLAN.md D24) beside activation, so the
// activation bundle carries none of it. Only this entry re-exports the
// layer, and the split gate pins its files to this bundle.
export * from './execGuard'
