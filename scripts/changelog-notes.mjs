#!/usr/bin/env node
// Prints the CHANGELOG.md section of one version (Keep a Changelog headings
// `## [x.y.z] - date`) to stdout, for release.yml's release notes. Exits 1
// when the version has no section, so a tag without a changelog entry
// cannot become a release.
//
//   node scripts/changelog-notes.mjs 0.2.0

import { readFile } from 'node:fs/promises'
import process from 'node:process'

const CHANGELOG_PATH = 'CHANGELOG.md'
const HEADING = /^## \[([^\]]+)\]/

const version = process.argv[2]
if (version === undefined || version === '') {
  console.error('usage: node scripts/changelog-notes.mjs <version>')
  process.exit(2)
}

const changelog = await readFile(CHANGELOG_PATH, 'utf8')
const lines = changelog.split(/\r?\n/)
const start = lines.findIndex((line) => HEADING.exec(line)?.[1] === version)
if (start === -1) {
  console.error(`${CHANGELOG_PATH} has no section for version ${version}`)
  process.exit(1)
}
let end = lines.findIndex((line, index) => index > start && HEADING.test(line))
if (end === -1) {
  end = lines.length
}
const body = lines
  .slice(start + 1, end)
  .join('\n')
  .trim()
if (body === '') {
  console.error(`the ${version} section of ${CHANGELOG_PATH} is empty`)
  process.exit(1)
}
process.stdout.write(`${body}\n`)
