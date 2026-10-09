#!/usr/bin/env node
import { buildNodeAuth } from './lib/buildNodeAuth.mjs'
try {
  const sizes = await buildNodeAuth()
  for (const item of sizes)
    console.log(`${item.file}: ${item.sizeKiB.toFixed(1)} KiB (budget ${item.budgetKiB} KiB)`)
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
