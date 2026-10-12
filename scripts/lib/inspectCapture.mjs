// Per-program capture for the B1 inspect boundary (M125 F1a, round 3).
// Runs every started program of the grammar's table once through a built
// confine helper and reports what happened: exit or signal, the helper's
// own stderr lines, whether the program produced output, and the resolved
// binary with its owner. Prints no workspace content, user name or home
// path: scratch and home prefixes are normalised out of every string.
import { spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// The grammar's started programs with the argv the tests run them with.
// `stat` is answered by the helper itself and starts no binary.
export const CAPTURE_PROGRAMS = [
  { program: 'ls', recursive: false, operands: ['.'], tool: ['-l', '.'], binary: '/bin/ls' },
  {
    program: 'cat',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['allowed.txt'],
    binary: '/bin/cat',
  },
  {
    program: 'head',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['-n', '1', 'allowed.txt'],
    binary: '/usr/bin/head',
  },
  {
    program: 'tail',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['-c', '2', 'allowed.txt'],
    binary: '/usr/bin/tail',
  },
  {
    program: 'wc',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['-l', 'allowed.txt'],
    binary: '/usr/bin/wc',
  },
  {
    program: 'stat',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['allowed.txt'],
    binary: '/usr/bin/stat',
    helperReport: true,
  },
  { program: 'du', recursive: true, operands: ['.'], tool: ['-s', '.'], binary: '/usr/bin/du' },
  {
    program: 'grep',
    recursive: false,
    operands: ['allowed.txt'],
    tool: ['-e', 'ALLOWED', 'allowed.txt'],
    binary: '/bin/grep',
  },
  {
    program: 'find',
    recursive: true,
    operands: ['.'],
    tool: ['.', '-print'],
    binary: '/usr/bin/find',
  },
]

const REFUSAL_LINE = /^\{"refused":"([a-zA-Z]+)"\}$/u
const CONFINED_LINE = /^\{"confined":true,"abi":\d+,"excluded":\d+\}$/u

function ownerOf(file) {
  try {
    const resolved = realpathSync(file)
    const uid = statSync(resolved).uid
    return { configured: file, resolved, owner: uid === 0 ? 'root' : `uid ${String(uid)}` }
  } catch {
    return { configured: file, resolved: null, owner: 'unresolved' }
  }
}

// The helper's own lines are the stderr lines it emits itself (the confined
// line and a refusal word), never a started program's output: a program
// killed by a signal can print anything, including JSON-looking text.
function helperLines(stderr) {
  return stderr
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => CONFINED_LINE.test(line) || REFUSAL_LINE.test(line))
}

export function createCaptureWorkspace(base) {
  const root = mkdtempSync(path.join(base, 'inspect-capture-'))
  const workspace = path.join(root, 'workspace')
  const home = path.join(root, 'home')
  mkdirSync(workspace, { recursive: true })
  mkdirSync(home, { mode: 0o700, recursive: true })
  writeFileSync(path.join(workspace, 'allowed.txt'), 'ALLOWED_CANARY\n')
  const identity = statSync(workspace)
  return { root, workspace, home, identity: `${String(identity.dev)}:${String(identity.ino)}` }
}

export function capturePrograms(helper, options = {}) {
  const scratchBase = options.scratchBase ?? os.tmpdir()
  const { root, workspace, home, identity } = createCaptureWorkspace(scratchBase)
  const rows = []
  for (const entry of CAPTURE_PROGRAMS) {
    const args = [
      'run',
      workspace,
      identity,
      home,
      entry.recursive ? 'recursive' : 'single',
      entry.program,
      ...entry.operands,
      '--',
      ...entry.tool,
    ]
    const child = spawnSync(helper, args, {
      cwd: root,
      env: {},
      encoding: 'utf8',
      timeout: 60_000,
    })
    const stdout = typeof child.stdout === 'string' ? child.stdout : ''
    const stderr = typeof child.stderr === 'string' ? child.stderr : ''
    let exit = 'spawn failed'
    if (child.status !== null && child.status !== undefined) exit = `exit ${String(child.status)}`
    else if (child.signal !== null && child.signal !== undefined) exit = `signal ${child.signal}`
    const lines = helperLines(stderr)
    const refusal =
      lines.map((line) => REFUSAL_LINE.exec(line)?.[1]).find((word) => word !== undefined) ?? null
    rows.push({
      program: entry.program,
      argv: [entry.program, ...entry.tool].join(' '),
      exit,
      helperLines: lines,
      refusal,
      programOutput: stdout.length > 0,
      outputBytes: stdout.length,
      binary:
        entry.helperReport === true
          ? { ...ownerOf(entry.binary), helperReport: true }
          : ownerOf(entry.binary),
    })
  }
  return { root, rows }
}

export function normaliseCaptureText(text, replacements) {
  // Longest first so a scratch root under the tmp dir normalises fully.
  const from = [...replacements, os.tmpdir(), os.homedir()]
    .filter((entry) => entry.length > 0)
    .toSorted((left, right) => right.length - left.length)
  let out = text
  for (const prefix of from) out = out.split(prefix).join('<scratch>')
  return out
}

const formatLine = (cells) => cells.join(' | ')

function formatBinary(binary) {
  if (binary.helperReport === true)
    return `(no program on current source; pre-round-1 source starts ${binary.configured} -> ${binary.resolved ?? 'unresolved'} (${binary.owner}))`
  return binary.resolved === null ? binary.configured : `${binary.resolved} (${binary.owner})`
}

export function formatCapture(rows, replacements) {
  const normalise = (value) => normaliseCaptureText(value, replacements)
  const out = [
    formatLine(['program', 'run', 'helper lines', 'program output', 'binary (owner)']),
    formatLine(['---', '---', '---', '---', '---']),
  ]
  for (const row of rows) {
    const helper =
      row.helperLines.length > 0
        ? row.helperLines.join('; ')
        : '(none: killed before any helper line)'
    const output = row.programOutput ? `yes, ${String(row.outputBytes)} bytes` : 'no'
    out.push(formatLine([row.program, row.exit, helper, output, formatBinary(row.binary)]))
  }
  return normalise(out.join('\n'))
}
