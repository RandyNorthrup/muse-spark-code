// dist/resourceAdmission.js: the window's one admission state and the lazy
// launch shims beside it. Every other bundle requires both from here
// (sharedResourceAdmission), so neither is ever copied.
export * from './admission'
export * from './launcher'

// Process identities belong to this process-wide admission boundary too.
// The vault store's exact-birth takeover checks read from here as well;
// every processOwner reader a lazy bundle imports must be re-exported,
// or the split gate fails the build.
export {
  currentProcessOwner,
  exactCurrentProcessOwner,
  exactProcessBirth,
  isProcessOwnerGone,
  processOwnerSchema,
} from '../locks/processOwner'
