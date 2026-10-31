// The creating process of the created-registry reclaim proof: the real
// registry (a bundle of test/unit/createdRegistryReclaimEntry.ts built by
// the caller) creates one temp tree, prints one JSON line, then holds,
// exits or finishes as its plan says. No credentials and no service traffic.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { runCreator } = require(process.argv[2])
await runCreator(process.argv[3])
