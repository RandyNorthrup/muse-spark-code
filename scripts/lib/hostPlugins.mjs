// The activation bundle's esbuild plugins (dist/extension.js and the bundles
// that reuse its options). scripts/build.mjs builds with this list, and the
// startup budget tests (teamStartup, modelsActivationBudget) build with it too,
// so a budget always measures the plugins production ships: a plugin added to
// the host build can no longer leave those tests measuring a bundle no one
// builds.
import {
  deferredCohort,
  sharedModelApiBoundaries,
  sharedResourceAdmission,
  sharedUiText,
  sharedValidation,
  sharedWire,
} from './deferredBundles.mjs'
import { deferredTeamView } from './deferredTeamView.mjs'

export const HOST_PLUGINS = Object.freeze([
  sharedUiText,
  sharedValidation,
  deferredCohort,
  sharedWire,
  sharedResourceAdmission,
  deferredTeamView,
  sharedModelApiBoundaries,
])
