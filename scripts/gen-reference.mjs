#!/usr/bin/env node
// Generates the code-derived reference or checks its coverage and freshness.
import process from 'node:process'
import { generateReference } from './lib/reference.mjs'
const isCheck = process.argv.includes('--check')
const model = await generateReference(process.cwd(), isCheck)
console.log(
  `Reference: ${model.features.length} features, ${model.commands.length} commands, ${model.settings.length} settings, ${model.slash.length} slash, ${model.cli.length} CLI; ${isCheck ? 'current' : 'generated'}`,
)
