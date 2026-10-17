// dist/resourceAdmission.js: the window's one admission state and the lazy
// launch shims beside it. Every other bundle requires both from here
// (sharedResourceAdmission), so neither is ever copied.
export * from './admission'
export * from './launcher'
