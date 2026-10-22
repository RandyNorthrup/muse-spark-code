// Lazy validated boundaries for the companion bridge (src/runtime/maker/assets.ts).
// The bridge awaits makerBoundarySchemas() from the startup bundle, so maker
// validation (and its Zod copy) stays in this deferred chunk instead of joining
// startup (PLAN.md D6, M57). Nothing in the eager panel imports this module.
export { makerHostMessageSchema, makerSurfaceMessageSchema } from '../../shared/makerProtocol'
