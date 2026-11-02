// The node crash hook's entry (M111 lane OB): the hook and its crash
// record builder live in dist/nodeCrashHook.js and load at node CLI
// startup, so the CLI's startup and argument parsing never carry zod
// (PLAN.md D6).
export { installNodeCrashHook } from './crashHook'
