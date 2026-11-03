// The estimate's fleet as the window reads it (M117, PLAN.md D6): esbuild builds this
// into dist/estimateFleet.js, required the first time an estimate runs, so neither the
// fleet binding nor its limit translators ride in activation.
export { extensionFleetSources, fleetIoFromSources, ownedSubscriptionUsage } from './fleetBinding'
export { estimatorSourcePorts } from './localFleet'
