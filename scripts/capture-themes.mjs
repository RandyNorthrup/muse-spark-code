#!/usr/bin/env node
// Captures the colours VS Code gives a webview in each of its four default
// themes (M37, PLAN.md D32), so the accessibility gate checks contrast
// against real values and not a guess. For each theme it starts the VS Code
// build the integration tests use, with a throwaway profile and no
// extensions, waits until the workbench wears the theme, and reads its
// `--vscode-*` custom properties through the Chrome DevTools Protocol (the
// workbench carries the same variables it hands a webview). Only the
// variables the webview's code uses are kept, in
// test/harness/themes/<kind>.json. Run it again when VS Code's default
// themes change:
//
//   node scripts/capture-themes.mjs

import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { downloadAndUnzipVSCode } from '@vscode/test-electron'
import * as z from 'zod/mini'

// `workbenchClass` is the class VS Code puts on `.monaco-workbench` once
// that theme is applied, named after the theme's file. The theme's type
// class (`vs-dark`) is not enough: a first capture read Dark Modern, a
// second one the fallback dark colours VS Code paints before the theme's own
// load, which had held still for the settle time. `bodyClass` is what VS
// Code puts on a webview's body.
const THEMES = [
  {
    kind: 'light',
    name: 'Default Light Modern',
    workbenchClass: 'vscode-theme-defaults-themes-light_modern-json',
    bodyClass: 'vscode-light',
  },
  {
    kind: 'dark',
    name: 'Default Dark Modern',
    workbenchClass: 'vscode-theme-defaults-themes-dark_modern-json',
    bodyClass: 'vscode-dark',
  },
  {
    kind: 'hc-dark',
    name: 'Default High Contrast',
    workbenchClass: 'vscode-theme-defaults-themes-hc_black-json',
    bodyClass: 'vscode-high-contrast',
  },
  {
    kind: 'hc-light',
    name: 'Default High Contrast Light',
    workbenchClass: 'vscode-theme-defaults-themes-hc_light-json',
    bodyClass: 'vscode-high-contrast vscode-high-contrast-light',
  },
]
const OUT_DIR = 'test/harness/themes'
const WEBVIEW_DIR = 'src/webview'
const VARIABLE_NAME = /--vscode-[A-Za-z0-9-]+/g
const LOOPBACK = '127.0.0.1'
const POLL_MS = 250
const SETTLE_MS = 1500
const START_TIMEOUT_MS = 90_000
const EVALUATE_ATTEMPTS = 20
const CONTEXT_GONE = /Execution context was destroyed|Cannot find context/
const execFileAsync = promisify(execFile)
// What VS Code and its DevTools endpoint send is checked before use
// (AGENTS.md rule 7): a changed build fails here, by name, not later.
const packageSchema = z.object({ version: z.string() })
const targetsSchema = z.array(
  z.object({
    type: z.string(),
    url: z.string(),
    webSocketDebuggerUrl: z.optional(z.string()),
  }),
)
// A reply carries the request's id; an event (none are asked for) has none.
const evaluateReplySchema = z.object({
  id: z.optional(z.number()),
  error: z.optional(z.unknown()),
  result: z.optional(
    z.object({
      result: z.optional(z.object({ value: z.optional(z.unknown()) })),
      exceptionDetails: z.optional(
        z.object({
          text: z.string(),
          exception: z.optional(z.object({ description: z.optional(z.string()) })),
        }),
      ),
    }),
  ),
})
const variablesSchema = z.record(z.string(), z.string())
// Started from inside VS Code (a terminal, a task), this process inherits
// ELECTRON_RUN_AS_NODE=1, which turns Code.exe into plain Node.js.
const { ELECTRON_RUN_AS_NODE: _runAsNode, ...ELECTRON_ENV } = process.env

/**
 * Resolves the workbench's `--vscode-*` values once it wears `themeClass`
 * and they have held still for SETTLE_MS: the theme a profile names is
 * applied after the default one has painted.
 */
function readVariablesScript(themeClass) {
  return `new Promise((resolve, reject) => {
  const started = Date.now()
  let previous
  let stableSince = 0
  const read = () => {
    const workbench = document.querySelector('.monaco-workbench')
    if (!workbench || !workbench.classList.contains(${JSON.stringify(themeClass)})) {
      return undefined
    }
    const style = getComputedStyle(workbench)
    const names = Array.from(style).filter((name) => name.startsWith('--vscode-')).sort()
    return names.length === 0 ? undefined : JSON.stringify(names.map((name) => [name, style.getPropertyValue(name).trim()]))
  }
  const poll = () => {
    const current = read()
    if (current !== undefined && current === previous) {
      if (Date.now() - stableSince >= ${String(SETTLE_MS)}) {
        resolve(Object.fromEntries(JSON.parse(current)))
        return
      }
    } else {
      previous = current
      stableSince = Date.now()
    }
    if (Date.now() - started > ${String(START_TIMEOUT_MS)}) {
      reject(new Error('the workbench never settled on the theme'))
      return
    }
    setTimeout(poll, ${String(POLL_MS)})
  }
  poll()
})`
}

/** Every `--vscode-*` name the webview's code mentions. */
async function usedVariables() {
  const names = new Set()
  const files = readdirSync(WEBVIEW_DIR, { recursive: true }).filter((file) =>
    /\.(css|tsx?)$/.test(String(file)),
  )
  for (const file of files) {
    const text = await readFile(path.join(WEBVIEW_DIR, String(file)), 'utf8')
    for (const [name] of text.matchAll(VARIABLE_NAME)) {
      names.add(name)
    }
  }
  return [...names].toSorted((left, right) => left.localeCompare(right))
}

/** The installed build's version, from its own package.json. */
async function versionOf(executable) {
  const folder = path.dirname(executable)
  const candidates = [
    path.join(folder, 'resources', 'app', 'package.json'),
    path.join(folder, '..', 'Resources', 'app', 'package.json'),
    // Windows archives keep the app in a folder named by the commit.
    ...readdirSync(folder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(folder, entry.name, 'resources', 'app', 'package.json')),
  ]
  const found = candidates.find((candidate) => existsSync(candidate))
  if (found === undefined) {
    throw new Error(`no package.json beside ${executable}`)
  }
  return packageSchema.parse(JSON.parse(await readFile(found, 'utf8'))).version
}

/** A loopback port nothing listens on right now. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, LOOPBACK, () => {
      const { port } = server.address()
      server.close(() => {
        resolve(port)
      })
    })
  })
}

/** DevTools' target list as sent, or undefined while nothing listens yet. */
async function devToolsTargets(port) {
  try {
    const response = await fetch(`http://${LOOPBACK}:${String(port)}/json/list`)
    return await response.json()
  } catch {
    // Not listening yet.
    return
  }
}

/** The workbench page's DevTools socket, once it exists. */
async function workbenchSocket(port) {
  const started = Date.now()
  while (Date.now() - started < START_TIMEOUT_MS) {
    const targets = await devToolsTargets(port)
    // A list of another shape is an error now, not a timeout later.
    const page =
      targets === undefined
        ? undefined
        : targetsSchema
            .parse(targets)
            .find((target) => target.type === 'page' && target.url.includes('workbench'))
    if (page?.webSocketDebuggerUrl !== undefined) {
      return page.webSocketDebuggerUrl
    }
    await delay(POLL_MS)
  }
  throw new Error(`no workbench page on DevTools port ${String(port)}`)
}

/** One Runtime.evaluate over the DevTools Protocol, awaiting the promise it returns. */
function evaluate(webSocketUrl, expression) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(webSocketUrl)
    socket.addEventListener('open', () => {
      socket.send(
        JSON.stringify({
          id: 1,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      )
    })
    socket.addEventListener('message', (event) => {
      let message
      try {
        message = evaluateReplySchema.parse(JSON.parse(String(event.data)))
      } catch (error) {
        socket.close()
        reject(new Error(`DevTools sent a message of another shape: ${String(error)}`))
        return
      }
      if (message.id !== 1) {
        return
      }
      socket.close()
      if (message.error !== undefined) {
        reject(new Error(`DevTools refused Runtime.evaluate: ${JSON.stringify(message.error)}`))
        return
      }
      const details = message.result?.exceptionDetails
      if (details === undefined) {
        resolve(message.result?.result?.value)
      } else {
        reject(new Error(details.exception?.description ?? details.text))
      }
    })
    socket.addEventListener('error', () => {
      reject(new Error(`the DevTools socket ${webSocketUrl} failed`))
    })
  })
}

// The workbench reloads its page once while it starts, which destroys the
// context an evaluation runs in; that one error is retried.
async function evaluateOnceSettled(port, expression) {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await evaluate(await workbenchSocket(port), expression)
    } catch (error) {
      if (attempt >= EVALUATE_ATTEMPTS || !CONTEXT_GONE.test(String(error))) {
        throw error
      }
      await delay(POLL_MS * 2)
    }
  }
}

async function stop(child) {
  if (child.exitCode !== null) {
    return
  }
  if (process.platform === 'win32') {
    const taskkill = path.join(process.env.SystemRoot ?? '', 'System32', 'taskkill.exe')
    try {
      await execFileAsync(taskkill, ['/PID', String(child.pid), '/T', '/F'])
    } catch {
      // Gone between the check and the kill.
    }
    return
  }
  try {
    process.kill(-child.pid, 'SIGKILL')
  } catch {
    child.kill('SIGKILL')
  }
}

async function capture(executable, theme) {
  const profile = await mkdtemp(path.join(tmpdir(), 'muse-theme-'))
  const extensions = await mkdtemp(path.join(tmpdir(), 'muse-theme-ext-'))
  await mkdir(path.join(profile, 'User'), { recursive: true })
  await writeFile(
    path.join(profile, 'User', 'settings.json'),
    JSON.stringify({
      'workbench.colorTheme': theme.name,
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'workbench.enableExperiments': false,
      'security.workspace.trust.enabled': false,
    }),
  )
  const port = await freePort()
  const args = [
    `--user-data-dir=${profile}`,
    `--extensions-dir=${extensions}`,
    '--disable-extensions',
    '--skip-welcome',
    '--skip-release-notes',
    '--new-window',
    `--remote-debugging-port=${String(port)}`,
  ]
  const options = { stdio: 'ignore', detached: process.platform !== 'win32', env: ELECTRON_ENV }
  // nosemgrep: javascript.lang.security.detect-child-process.detect-child-process -- the executable is the VS Code build @vscode/test-electron downloaded, the arguments are this script's own, and both go as an argument array with no shell (PLAN.md §8)
  const child = spawn(executable, args, options)
  try {
    return await evaluateOnceSettled(port, readVariablesScript(theme.workbenchClass))
  } finally {
    await stop(child)
    for (const folder of [profile, extensions]) {
      await rm(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 })
    }
  }
}

async function main() {
  const executable = await downloadAndUnzipVSCode('stable')
  const version = await versionOf(executable)
  const used = await usedVariables()
  await mkdir(OUT_DIR, { recursive: true })
  for (const theme of THEMES) {
    const all = variablesSchema.parse(await capture(executable, theme))
    // A colour the theme leaves unset is absent, as it is in a real
    // webview, so the stylesheet's own fallback applies.
    const variables = Object.fromEntries(
      used.filter((name) => all[name] !== undefined).map((name) => [name, all[name]]),
    )
    const unset = used.filter((name) => all[name] === undefined)
    const file = path.join(OUT_DIR, `${theme.kind}.json`)
    const snapshot = {
      source: `VS Code ${version}, theme "${theme.name}", read from the workbench by scripts/capture-themes.mjs`,
      kind: theme.kind,
      bodyClass: theme.bodyClass,
      variables,
      unset,
    }
    await writeFile(file, `${JSON.stringify(snapshot, undefined, 2)}\n`)
    console.log(
      `${theme.name}: ${String(Object.keys(variables).length)} set, ${String(unset.length)} unset → ${file}`,
    )
  }
}

await main()
