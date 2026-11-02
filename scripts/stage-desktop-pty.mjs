#!/usr/bin/env node
// Muse Desktop (M111, D91.13) lane BP: stages node-pty's native binding
// for Electron. The checkout's binding answers plain Node (unit tests,
// scripts); Electron needs the same sources compiled against its own
// headers, which node-pty finds under `prebuilds/<platform>-<arch>/`
// after its Node-ABI `build/Release` copy refuses to load. This script
// compiles that copy from the pinned sources and stages it — into the
// packaged app by default (`npm run package:desktop` runs this after
// assembling `dist/desktop-app`), or with `--dev` into the checkout's
// own node-pty so a dev run (`electron dist/desktop/main.mjs`) gets
// working terminals. `npm run build` never calls it: the production
// build stays toolchain-free, and packaging refuses without node-gyp.
//
// Proven on linux-x64; the win32 companion list below follows node-pty's
// own prebuild layout and awaits the packaging lanes' Windows run.

import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const ELECTRON_HEADERS = 'https://electronjs.org/headers'
// One compile, no retries: past ten minutes the toolchain is wedged,
// not slow, and its own log says where.
const BUILD_TIMEOUT_MS = 600_000

const rootDir = process.cwd()
const nodePtyDir = path.join(rootDir, 'node_modules', 'node-pty')
const buildDir = path.join(rootDir, 'temp', 'desktop-pty-build', 'node-pty')
const platformTag = `${process.platform}-${process.arch}`
// The compiled binding outlives any one package: packaging wipes the
// app folder (and its stamp) every run, so a cache in the worktree's
// temp keeps repackaging from recompiling what it just built.
const cacheDir = path.join(rootDir, 'temp', 'desktop-pty-cache', platformTag)

function fail(message) {
  throw new Error(`stage-desktop-pty: ${message}`)
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'))
}

function electronVersion() {
  const file = path.join(rootDir, 'node_modules', 'electron', 'package.json')
  if (!existsSync(file)) fail('the pinned Electron download is missing; install first')
  const version = readJson(file).version
  if (typeof version !== 'string' || version === '') fail('Electron has no version to build for')
  return version
}

function nodePtyVersion() {
  const file = path.join(nodePtyDir, 'package.json')
  if (!existsSync(file)) fail('node-pty is missing; install first')
  const version = readJson(file).version
  if (typeof version !== 'string' || version === '') fail('node-pty has no version to stamp')
  return version
}

function npmBundledNodeGyp() {
  let globalRoot
  try {
    globalRoot = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
  const candidate = path.join(globalRoot, 'npm', 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  return existsSync(candidate) ? candidate : null
}

function pathNodeGyp() {
  const probed = spawnSync('node-gyp', ['--version'], { stdio: 'ignore' })
  return probed.status === 0 ? 'node-gyp' : null
}

/** The node-gyp launch as [command, ...leadingArgs]. */
function resolveNodeGyp(flag) {
  if (flag !== null) {
    if (!existsSync(flag)) fail(`--node-gyp ${flag} is missing`)
    return flag.endsWith('.js') ? [process.execPath, flag] : [flag]
  }
  const onPath = pathNodeGyp()
  if (onPath !== null) return [onPath]
  const bundled = npmBundledNodeGyp()
  if (bundled !== null) return [process.execPath, bundled]
  fail('node-gyp is missing; `npm install -g node-gyp` (or pass --node-gyp) and run again')
}

function stageRoot(isDev) {
  const appDir = path.join(rootDir, 'dist', 'desktop-app', 'resources', 'app')
  if (isDev || existsSync(appDir)) {
    return isDev ? nodePtyDir : path.join(appDir, 'node_modules', 'node-pty')
  }
  fail('dist/desktop-app is missing; run npm run package:desktop first')
}

function stampMatches(dest, electron, nodePty) {
  const stampFile = path.join(dest, '.staged-pty.json')
  const bindingFile = path.join(dest, 'prebuilds', platformTag, 'pty.node')
  if (!existsSync(stampFile) || !existsSync(bindingFile)) return false
  try {
    const stamp = readJson(stampFile)
    return stamp.electron === electron && stamp.nodePty === nodePty && stamp.tag === platformTag
  } catch {
    return false
  }
}

function cacheMatches(electron, nodePty) {
  const stampFile = path.join(cacheDir, '.cached-pty.json')
  const bindingFile = path.join(cacheDir, 'pty.node')
  if (!existsSync(stampFile) || !existsSync(bindingFile)) return false
  try {
    const stamp = readJson(stampFile)
    return stamp.electron === electron && stamp.nodePty === nodePty
  } catch {
    return false
  }
}

function copySources() {
  rmSync(path.dirname(buildDir), { recursive: true, force: true })
  mkdirSync(buildDir, { recursive: true })
  // Everything but previous outputs: binding.gyp resolves the nested
  // node-addon-api from here at configure time. The staged copy takes
  // only lib, package.json and the fresh prebuilds.
  cpSync(nodePtyDir, buildDir, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(nodePtyDir, source)
      return (
        relative === '' ||
        (!relative.startsWith(`build${path.sep}`) &&
          relative !== 'build' &&
          !relative.startsWith(`prebuilds${path.sep}`) &&
          relative !== 'prebuilds')
      )
    },
  })
}

function compileBinding(nodeGyp, electron, devdir) {
  const [command, ...leading] = nodeGyp
  const run = spawnSync(
    command,
    [
      ...leading,
      'rebuild',
      `--target=${electron}`,
      `--dist-url=${ELECTRON_HEADERS}`,
      ...(devdir === null ? [] : [`--devdir=${devdir}`]),
    ],
    { cwd: buildDir, stdio: 'inherit', timeout: BUILD_TIMEOUT_MS },
  )
  if (run.error === undefined && run.status === 0) return
  let why = `node-gyp exited ${String(run.status)}`
  if (run.error !== undefined) {
    why = 'node-gyp did not start'
  } else if (run.signal !== null) {
    why = `node-gyp stopped on ${run.signal}`
  }
  fail(`${why}; its log is above and the sources stay at ${path.relative(rootDir, buildDir)}`)
}

function stageBinding(dest) {
  const releaseDir = path.join(buildDir, 'build', 'Release')
  const binding = path.join(releaseDir, 'pty.node')
  if (!existsSync(binding)) fail('node-gyp built nothing loadable (no pty.node)')
  const prebuildsDir = path.join(dest, 'prebuilds', platformTag)
  mkdirSync(prebuildsDir, { recursive: true })
  cpSync(binding, path.join(prebuildsDir, 'pty.node'))
  // The Unix spawn helper beside the binding it serves; the Windows
  // companions node-pty ships in its own prebuilds (the agents and the
  // console list) beside theirs.
  const companions =
    process.platform === 'win32'
      ? ['winpty-agent.exe', 'winpty.dll', 'conpty_console_list.node']
      : ['spawn-helper']
  for (const name of companions) {
    const produced = path.join(releaseDir, name)
    if (existsSync(produced)) cpSync(produced, path.join(prebuildsDir, name))
  }
  const conptyDir = process.platform === 'win32' ? path.join(releaseDir, 'conpty') : null
  if (conptyDir !== null && existsSync(conptyDir)) {
    cpSync(conptyDir, path.join(prebuildsDir, 'conpty'), { recursive: true })
  }
}

const args = process.argv.slice(2)
const isDev = args.includes('--dev')
const flagAt = args.indexOf('--node-gyp')
const nodeGypFlag = flagAt === -1 ? null : (args[flagAt + 1] ?? null)
if (flagAt !== -1 && nodeGypFlag === null) fail('--node-gyp needs the node-gyp launch')
const devdirAt = args.indexOf('--devdir')
const devdirFlag = devdirAt === -1 ? null : (args[devdirAt + 1] ?? null)
if (devdirAt !== -1 && devdirFlag === null) fail('--devdir needs the headers cache folder')

const electron = electronVersion()
const nodePty = nodePtyVersion()
const dest = stageRoot(isDev)

function stageModule() {
  if (isDev) return
  mkdirSync(dest, { recursive: true })
  cpSync(path.join(nodePtyDir, 'package.json'), path.join(dest, 'package.json'))
  cpSync(path.join(nodePtyDir, 'lib'), path.join(dest, 'lib'), { recursive: true })
}
if (stampMatches(dest, electron, nodePty)) {
  console.log(`stage-desktop-pty: ${platformTag} for Electron ${electron} is already staged`)
  process.exit(0)
}
if (cacheMatches(electron, nodePty)) {
  stageModule()
  const prebuildsDir = path.join(dest, 'prebuilds', platformTag)
  mkdirSync(prebuildsDir, { recursive: true })
  cpSync(cacheDir, prebuildsDir, {
    recursive: true,
    filter: (source) => path.basename(source) !== '.cached-pty.json',
  })
} else {
  const nodeGyp = resolveNodeGyp(nodeGypFlag)
  copySources()
  // Without the flag, node-gyp's own `npm_config_devdir` answers (the
  // rig lanes keep their headers cache in the worktree's temp/).
  compileBinding(nodeGyp, electron, devdirFlag ?? process.env['npm_config_devdir'] ?? null)
  stageBinding(dest)
  stageModule()
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  cpSync(path.join(dest, 'prebuilds', platformTag), cacheDir, { recursive: true })
  writeFileSync(
    path.join(cacheDir, '.cached-pty.json'),
    `${JSON.stringify({ electron, nodePty })}\n`,
  )
}
writeFileSync(
  path.join(dest, '.staged-pty.json'),
  `${JSON.stringify({ electron, nodePty, tag: platformTag })}\n`,
)
rmSync(path.dirname(buildDir), { recursive: true, force: true })
console.log(`stage-desktop-pty: ${platformTag} for Electron ${electron} staged at ${dest}`)
