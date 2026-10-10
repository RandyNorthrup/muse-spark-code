// The snapshot bundle's entry (M117 C-M117-1, PLAN.md D6):
// dist/planSnapshot.js, required the first time an estimate needs a plan
// snapshot. It reads no `vscode`, so a stray import fails this build.
export {
  createPlanCheckSource,
  createPlanSnapshotSource,
  installPlanSnapshotText,
} from './planSnapshotSource'
