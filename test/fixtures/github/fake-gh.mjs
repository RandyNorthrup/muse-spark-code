#!/usr/bin/env node
// A fake GitHub CLI for D104's source (c): it answers only
// `gh auth token --hostname github.com`, the one command the runtime runs.
// Its state comes from FAKE_GH_STATE (JSON):
//
//   { "accounts": { "<login>": "<token>" }, "active": "<login>" }
//
// It prints the active account's token, as `gh` does when several accounts
// are signed in; with no account it exits 1 (signed out). Any other
// arguments exit 2, so a test sees a changed command line. When
// FAKE_GH_RECORD names a file, it appends its arguments and the names of
// its environment variables there (never their values), for the token grep.
// gh's own messages were not captured; the runtime reads only the exit code
// and standard output.

import { appendFileSync } from 'node:fs'

const EXPECTED = ['auth', 'token', '--hostname', 'github.com']
const args = process.argv.slice(2)
const record = process.env.FAKE_GH_RECORD
if (record !== undefined && record !== '') {
  appendFileSync(
    record,
    `${JSON.stringify({ args, environment: Object.keys(process.env).toSorted((left, right) => left.localeCompare(right)) })}\n`,
  )
}
if (args.length !== EXPECTED.length || args.some((arg, index) => arg !== EXPECTED[index])) {
  process.stderr.write('fake gh: unexpected arguments\n')
  process.exit(2)
}
const state = JSON.parse(process.env.FAKE_GH_STATE ?? '{"accounts":{}}')
const token = state.active === undefined ? undefined : state.accounts?.[state.active]
if (typeof token !== 'string') {
  process.stderr.write('fake gh: not signed in to github.com\n')
  process.exit(1)
}
process.stdout.write(`${token}\n`)
