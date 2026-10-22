// One process of the created-registry race: the real registry (a bundle of
// test/hosts/created-registry-race-entry.ts built by the caller) on the
// shared manifest file. Every process meets the others at the same instant
// and creates temporary roots; each create saves the manifest twice through
// the native compare-and-swap publish. Reports one JSON line at the end. No
// credentials and no service traffic.
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { runWorker } = require(process.argv[2])
process.stdout.write(await runWorker(process.argv[3]))
