#!/usr/bin/env node
// The two VS Code versions the integration tests download, as
// `name=value` lines for $GITHUB_OUTPUT: the floor from package.json and
// the current stable release from VS Code's update service (the list
// @vscode/test-electron resolves "stable" from). CI keys its cache of
// .vscode-test/vscode-* on both, so a new stable release or a moved floor
// downloads afresh and nothing else does (M26, PLAN.md D29). When the
// service cannot be reached the stable entry says so and the cache key
// simply misses; the test run then reports the network failure itself.

import { get } from 'node:https'
import { minimumVsCodeVersion } from './lib/vscode-engine.mjs'

const STABLE_RELEASES_URL = 'https://update.code.visualstudio.com/api/releases/stable'
const REQUEST_TIMEOUT_MS = 15_000
const UNRESOLVED = 'unresolved'

function unresolved(reason) {
  console.error(`::warning::the latest VS Code stable could not be resolved: ${String(reason)}`)
  return UNRESOLVED
}

/** The first entry of the update service's stable list: the newest release. */
function latestStable() {
  return new Promise((resolve) => {
    const request = get(STABLE_RELEASES_URL, { timeout: REQUEST_TIMEOUT_MS }, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          const releases = JSON.parse(body)
          const [latest] = Array.isArray(releases) ? releases : []
          resolve(typeof latest === 'string' ? latest : unresolved('no release list'))
        } catch (error) {
          resolve(unresolved(error))
        }
      })
    })
    request.on('timeout', () => {
      request.destroy(new Error(`no answer in ${String(REQUEST_TIMEOUT_MS)} ms`))
    })
    request.on('error', (error) => {
      resolve(unresolved(error))
    })
  })
}

console.log(`minimum=${minimumVsCodeVersion()}`)
console.log(`stable=${await latestStable()}`)
