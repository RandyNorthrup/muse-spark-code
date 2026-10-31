// The first-boot setup's entry (M110os RLF-MUSESETUP, D229): the setup
// server and its install step live in dist/nodeSetup.js and load only
// when the first boot runs them, so dist/node.js never carries the seed
// reader's YAML parser (PLAN.md D6). The first-boot unit wires the load;
// until then the drill launcher imports the chunk straight from the
// staged runtime.
export { createSetupServer, prepareSetupState } from './server'
export type { SetupServer, SetupServerOptions } from './server'
