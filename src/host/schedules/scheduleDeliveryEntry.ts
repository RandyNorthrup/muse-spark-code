// The schedules' deferred editor-delivery binding (D6): the workspace
// targets, run dispatch and grant checks behind the editor delivery ports.
// dist/schedules.js loads this as dist/scheduleDelivery.js on the first
// delivery; a bundle that cannot load refuses the run that needed it, never
// an undelivered run and never a default target.
export { createScheduleDeliveryBinding } from './deliveryBinding'
export type { ScheduleEditorDeliveryPorts } from './deliveryBinding'
