#!/usr/bin/env node
// The extension host runs on Node 22, where `navigator` is a global; VS Code
// replaces it with a getter that reports a PendingMigrationError and answers
// undefined ("navigator is now a global in nodejs",
// src/vs/workbench/api/node/extensionHostProcess.ts, since 1.101), and a
// bundled library that sniffs `typeof navigator` to detect a browser has
// broken other extensions that way (zod's Cloudflare check, openai/codex
// #43476). Our host bundles never touch it (zod/mini leaves that check out);
// this gate keeps it so (M26, PLAN.md D29). Exits 1 on any reference.

import { readFileSync } from 'node:fs'

const HOST_BUNDLES = ['dist/extension.js', 'dist/searchWorker.js']
const NAVIGATOR = /\bnavigator\b/g

let hasFailure = false
for (const bundle of HOST_BUNDLES) {
  const count = readFileSync(bundle, 'utf8').match(NAVIGATOR)?.length ?? 0
  if (count > 0) {
    hasFailure = true
  }
  console.log(
    `${count === 0 ? 'ok  ' : 'FAIL'} ${bundle}: ${String(count)} reference(s) to navigator`,
  )
}

if (hasFailure) {
  console.error(
    'the extension host bundle reads `navigator`; guard with `typeof process === "object" && process.versions.node` first (PLAN.md D29)',
  )
  process.exit(1)
}
