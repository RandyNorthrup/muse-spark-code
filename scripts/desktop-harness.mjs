#!/usr/bin/env node
// The M111 desktop test rig (lane QA): one command to check the machine,
// look at a desktop scene, or run a scene under headless Hyprland and tear
// everything down. Logic lives in test/desktop/harness/lib/.

import process from 'node:process'
import { runHarnessCli } from '../test/desktop/harness/lib/harnessCli.mjs'

try {
  process.exitCode = await runHarnessCli(process.argv.slice(2), { repoRoot: process.cwd() })
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
