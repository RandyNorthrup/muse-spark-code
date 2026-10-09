// M115 fake-only schedule scenes. Kept apart from schedules.mjs, whose browser
// code imports the built surface (temp/m115-v), so Node tooling that only needs
// the scene names (the harness server, and every test importing it) never
// resolves a build output that a clean checkout does not have.
export const SCHEDULE_SCENES = [
  'schedules-v2-background',
  'schedules-v2-background-narrow',
  'schedules-v2-list',
  'schedules-v2-list-narrow',
  'schedules-v2-editor',
  'schedules-v2-editor-narrow',
  'schedules-v2-timeline',
  'schedules-v2-timeline-narrow',
  'schedule-settlements',
  'schedule-settlements-narrow',
]
