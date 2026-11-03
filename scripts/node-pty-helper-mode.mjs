#!/usr/bin/env node
// node-pty 1.1.0 publishes its macOS spawn helpers without the execute bit, and its
// own install step does not set it, so every terminal in a macOS checkout fails with
// `posix_spawnp failed`. Runs at install (the `prepare` script). A packaged app is not
// affected: scripts/stage-desktop-pty.mjs compiles its own helper.
import { chmodSync, existsSync } from 'node:fs'

if (process.platform === 'darwin') {
  const EXECUTABLE = 0o755
  for (const arch of ['arm64', 'x64']) {
    const helper = `node_modules/node-pty/prebuilds/darwin-${arch}/spawn-helper`
    if (existsSync(helper)) chmodSync(helper, EXECUTABLE)
  }
}
