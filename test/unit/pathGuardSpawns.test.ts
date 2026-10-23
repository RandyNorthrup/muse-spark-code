// PATHGUARD spawn inventory (Grok re-review of PR #249): every direct
// child-process start, every wrapper that ends in one, every embedded
// supervisor script, and every raw governed launch in src/ is enumerated
// from the source itself and must either route through the guarded lookup +
// child environment or stand on the short reviewed lists below with its
// reason. Since round 7 only two modules may start a process directly —
// the one guarded wrapper and the tree helpers whose signatures already
// take the branded environment — so a new direct `spawn`/`execFile` import
// anywhere else fails the first test below, and a bypass of the branded
// types fails the last. Remove a guard and its anchor fails with it.
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as ts from 'typescript'

const SRC = path.join(__dirname, '..', '..', 'src')

/** Process starts by bare name, however the file spells the import. */
const SPAWN_NAMES = new Set(['spawn', 'spawnSync', 'execFile', 'execFileSync', 'fork'])
/** Shell-string starts stay banned (PLAN.md D4): none may be imported. */
const SHELL_NAMES = new Set(['exec', 'execSync'])
/** The raw governed launch: only `commands.ts` (guarded) may resolve bare names through it. */
const LAUNCH_NAME = 'spawnResourceProcess'
/**
Wrappers that end in a process start, taking the program as their first
argument: `runProgram` (`execFile` with a timeout), `runTreeSync`
(`spawnSync` under the POSIX supervisor), `runResourceCommand` (the
governed runner), `execResourceFile` and `handoffResourceFile` (the
governed command boundary in commands.ts: guarded lookup + child env for
the run workspace). A bare call with a literal or a variable command alike
is a spawn the direct-start walk cannot see (round 5: the playbook's bare
`git` variable and the team probes' bare names stayed green; round 6: the
report's `gh` through an unscanned `execResourceFile`).
*/
const WRAPPER_NAMES = new Set([
  'runProgram',
  'runTreeSync',
  'runResourceCommand',
  'execResourceFile',
  'handoffResourceFile',
])

interface KnownSpawn {
  /** Guarded in this file, or reviewed with the reason below. */
  readonly kind: 'guarded' | 'reviewed'
  /** A string of the verified mechanism that must stay in the file. */
  readonly anchor: string
  readonly reason: string
}

/**
Round 7 closed the class: every start not listed here moved behind
`spawnGuarded` / `execFileGuarded` (whose signatures take only the branded
environment) or the already-branded `runProgram` / `runTreeSync` /
governed launch. The entries below are the direct starters the 0.19.0
join still keeps beside the guarded wrapper, each with its reviewed
mechanism. A direct `spawn`/`execFile` value import anywhere else is an
unknown file below.
*/
const KNOWN: Record<string, KnownSpawn> = {
  'src/core/guardedChildProcess.ts': {
    kind: 'guarded',
    anchor: 'GuardedChildEnv',
    reason: 'the one guarded wrapper: spawnGuarded/execFileGuarded take only the branded child env',
  },
  'src/core/backends/musecode/sandbox.ts': {
    kind: 'reviewed',
    anchor: 'resolveExecutable',
    reason: 'absolute bwrap probe from the guarded lookup (workspace excluded), no shell',
  },
  'src/core/eval/armSources.ts': {
    kind: 'reviewed',
    anchor: 'process.execPath',
    reason: 'fixed process.execPath arm runner + empty env',
  },
  'src/core/eval/mechanisms.ts': {
    kind: 'reviewed',
    anchor: 'process.execPath',
    reason:
      'fixed process.execPath config reader with an empty env; bare git reads the tracked set only',
  },
  'src/host/processTree.ts': {
    kind: 'guarded',
    anchor: 'GuardedChildEnv',
    reason:
      'runProgram (execFile) and runTreeSync (spawnSync) take only the branded child env; the supervisor template itself is parsed by the embedded-script check',
  },
  'src/host/estimator/planSnapshotSource.ts': {
    kind: 'guarded',
    anchor: 'resolveExecutable',
    reason: 'gh/git resolved through the guarded lookup; scrubbed env, bounded output',
  },
  'src/core/estimator/calibration/sources.ts': {
    kind: 'guarded',
    anchor: 'noWorkspaceChildEnvironment',
    reason:
      'git resolved through the guarded lookup outside the history root; execFile takes only the branded credential-free child env, bounded output, hidden window',
  },
  'src/host/media/recordingLatest.ts': {
    kind: 'reviewed',
    anchor: 'windowsPowerShell',
    reason:
      "absolute System32 powershell only (windowsPowerShell: guarded, credential-free, 5.1's own module path), no shell, hidden window",
  },
  'src/runtime/converterTrust.ts': {
    kind: 'reviewed',
    anchor: 'systemPowerShell',
    reason:
      "absolute System32 powershell only (verifier-selected, windowsPowerShell: guarded, credential-free, 5.1's own module path), no shell",
  },
  'src/runtime/vault/windowsPipeRelay.ts': {
    kind: 'reviewed',
    anchor: 'verifyWindowsVaultFileSync',
    reason: 'digest-pinned helper verified before the one-shot sync start; SystemRoot-only env',
  },
  'src/core/resources/sampler/darwinMemory.ts': {
    kind: 'reviewed',
    anchor: 'RESOURCE_PROBE_EMPTY_ENV_KEYS',
    reason:
      'the packaged signed macOS helper at its absolute path in fixed --memory-headroom mode, an env of emptied probe keys only, no shell (M107)',
  },
  'src/runtime/panel/pullRequests/unconfiguredGit.ts': {
    kind: 'reviewed',
    anchor: 'beforeSpawn()',
    reason:
      "direct git only when resource admission is absent (the shared runner's unconfigured rule): the caller gate runs synchronously before each launch, argument array, no shell, bounded output and deadline, hidden window",
  },
  'src/host/backend/deviceWorkerDarwin.ts': {
    kind: 'reviewed',
    anchor: 'workerEnvironment',
    reason:
      'fixed absolute commands only (/bin/launchctl, /bin/ps, /usr/bin/clang) plus the sha-pinned compiled helper beside the private store, all through the one program boundary with a workerEnvironment-scrubbed env, argument arrays, no shell',
  },
  'src/host/devices/windowsStorageProtection.ts': {
    kind: 'reviewed',
    anchor: 'HELPER_TOKEN',
    reason:
      'the shipped C# helper compiled once per source into the private directory and ping-proved before use; SystemRoot-only env, argument array, no shell',
  },
}

const KNOWN_WRAPPER: Record<string, KnownSpawn> = {
  'src/host/estimator/planSnapshotSource.ts': {
    kind: 'guarded',
    anchor: 'resolveExecutable',
    reason: 'program names resolve through the guarded lookup before the bounded run',
  },
  'src/runtime/trustedPath.ts': {
    kind: 'reviewed',
    anchor: '/usr/bin/getent',
    reason: 'absolute packaged helper and /usr/bin/getent only, scrubbed env',
  },
  'src/core/orchestration/playbook/outcomes.ts': {
    kind: 'guarded',
    anchor: 'processGitPath',
    reason: 'git resolved outside the workspace + guarded child env for every effect',
  },
  'src/core/reporting/sources/github.ts': {
    kind: 'guarded',
    anchor: 'workspaceRoot',
    reason:
      'gh resolved with the report workspace scope (links followed) + exec workspaceRoot for it; an absolute gh inside it is refused',
  },
  'src/core/schedules/events/git.ts': {
    kind: 'guarded',
    anchor: 'workspaceRoot',
    reason: 'schedule git reads pass the schedule workspace into the governed exec',
  },
  'src/runtime/reporting/sources.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: 'git resolved outside the report workspace (links followed) + guarded child env',
  },
  'src/runtime/schedules/nodeBackgroundIo.ts': {
    kind: 'reviewed',
    anchor: 'trustedBackgroundPath',
    reason: 'trust-checked schedule launcher with the schedule env',
  },
  'src/runtime/main.ts': {
    kind: 'guarded',
    anchor: 'workspaceRoot',
    reason: '`muse login`: guarded launch resolution + guarded child env',
  },
  'src/runtime/sharing/sharingEntry.ts': {
    kind: 'guarded',
    anchor: 'workspaceRoot',
    reason: 'fixed clipboard/browser adapters handed off with the shared workspace',
  },
  'src/core/orchestration/playbook/renamedFiles.ts': {
    kind: 'guarded',
    anchor: 'processGitPath',
    reason: 'git resolved outside the workspace + guarded child env for rename reads',
  },
  'src/host/team/processLifetime.ts': {
    kind: 'guarded',
    anchor: 'resolveExecutable',
    reason:
      'setpriv/systemd-run/systemctl resolved outside the launch cwd + guarded child env (probes on absolute entries only)',
  },
  'src/host/team/processOwnership.ts': {
    kind: 'reviewed',
    anchor: '/usr/bin/python3',
    reason: 'fixed /usr/bin/python3 only, empty env',
  },
  'src/core/team/workers/workerOps.ts': {
    kind: 'reviewed',
    anchor: 'scrubWorkerEnv',
    reason:
      "the worker file helper by absolute path only (the packaged native helper, or the system root's PowerShell 5.1 with windowsPowerShellEnvironment), the scrubbed worker env, through the governed contained launcher (M96)",
  },
  'src/host/team/windowHints.ts': {
    kind: 'reviewed',
    anchor: 'windowsPowerShell',
    reason: 'absolute SystemRoot PowerShell only, no shell, no workspace cwd',
  },
  'src/host/team/orphanRecovery.ts': {
    kind: 'reviewed',
    anchor: '/usr/bin/python3',
    reason: 'fixed /usr/bin/python3 on darwin (Linux reads /proc, no spawn)',
  },
  'src/runtime/tokenFile.ts': {
    kind: 'reviewed',
    anchor: 'windowsPowerShell',
    reason: 'absolute SystemRoot PowerShell + fixed /bin/ls only',
  },
  'src/host/git/githubSession.ts': {
    kind: 'guarded',
    anchor: 'execResourceFile',
    reason:
      "'gh' resolved through the guarded lookup (workspace excluded) before the governed probe run",
  },
  'src/runtime/vault/clientLaunch.ts': {
    kind: 'guarded',
    anchor: 'handoffResourceFile',
    reason:
      'current-process node plus the packaged broker script through the governed handoff (shared by the POSIX and Windows clients)',
  },
  'src/runtime/vault/posixNative.ts': {
    kind: 'guarded',
    anchor: 'execResourceFile',
    reason: 'digest-pinned native peer identity probe with an empty env through the governed exec',
  },
  'src/runtime/panel/pullRequests/checkout.ts': {
    kind: 'guarded',
    anchor: 'checkoutChildEnvironment',
    reason:
      'checkout runs through the governed exec boundary (guarded lookup + guarded child env for the checkout directory); the caller gate is rechecked after admission and at Windows GO',
  },
}

const KNOWN_SCRIPT: Record<string, KnownSpawn> = {
  'src/host/processTree.ts': {
    kind: 'reviewed',
    anchor: 'spec.command',
    reason:
      "the POSIX supervisor spawns only its caller's spec.command: every runTreeSync caller resolves that command outside the workspace (wrapper list above)",
  },
  'src/host/backend/deviceWorkerDarwin.ts': {
    kind: 'reviewed',
    anchor: 'config[@"executable"]',
    reason:
      'the embedded helper spawns only its config executable (plus a fixed /usr/bin/true self-test probe with an empty env): every launch resolves that executable through the guarded tool lookup before writing the config',
  },
}

const KNOWN_LAUNCH: Record<string, KnownSpawn> = {
  'src/core/resources/commands.ts': {
    kind: 'guarded',
    anchor: 'resolveCommand',
    reason: 'the one bare-name boundary: guarded lookup + child env for the run workspace',
  },
  'src/core/media/convert.ts': {
    kind: 'reviewed',
    anchor: 'trustedPath',
    reason: 'trust-verified converter command only',
  },
  'src/core/bootstrapCommand.ts': {
    kind: 'reviewed',
    anchor: 'runBootstrap',
    reason: 'build-time helper builds with the host cwd, never a workspace cwd',
  },
  'src/core/vault/broker/peer.ts': {
    kind: 'reviewed',
    anchor: 'VaultPeerVerifier',
    reason: 'the peer verifier binary with an empty env',
  },
  'src/runtime/schedules/nodeBackgroundIo.ts': {
    kind: 'reviewed',
    anchor: 'trustedBackgroundPath',
    reason: 'trust-checked schedule launcher with the schedule env',
  },
  'src/runtime/main.ts': {
    kind: 'guarded',
    anchor: 'childEnvironment',
    reason: '`muse login`: guarded launch resolution + guarded child env',
  },
  'src/runtime/vault/slots/macVaultTransport.ts': {
    kind: 'reviewed',
    anchor: 'isAbsolute',
    reason: 'absolute helper path only, empty env',
  },
  'src/runtime/vault/slots/windowsVaultTransport.ts': {
    kind: 'reviewed',
    anchor: 'windowsVaultGuardScript',
    reason: 'hash-guarded helper script through absolute PowerShell',
  },
  'src/runtime/vault/posixNative.ts': {
    kind: 'reviewed',
    anchor: 'VAULT_FILE_SINGLE_LINK',
    reason: 'identity-checked vault file handle; the contained helper inherits the empty env',
  },
  'src/runtime/vault/slots/linuxTpm2Slot.ts': {
    kind: 'reviewed',
    anchor: 'systemd-creds',
    reason: 'fixed systemd-creds tool only through the contained launch; key on stdin, empty env',
  },
  'src/runtime/panel/pullRequests/checkout.ts': {
    kind: 'guarded',
    anchor: 'checkoutChildEnvironment',
    reason:
      'checkout batch starts through governed probe/contained profiles with the guarded child env for the checkout directory; the caller gate is rechecked after admission and at Windows GO',
  },
}

function walk(directory: string): string[] {
  const found: string[] = []
  const entries = readdirSync(directory, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      found.push(...walk(full))
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(full)
    }
  }
  return found
}

interface SpawnSite {
  readonly line: number
  readonly name: string
}

/** Direct child_process starts: bare calls of value-imported (or required) names. */
function directSpawns(
  file: string,
  text: string,
): { readonly starts: SpawnSite[]; readonly launches: SpawnSite[] } {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const imported = new Set<string>()
  const namespaces = new Set<string>()
  const launched = new Set<string>()
  const shellUsed: string[] = []
  const visitImport = (node: ts.Node): void => {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.importClause !== undefined
    ) {
      const specifier = node.moduleSpecifier.text
      if (specifier === 'node:child_process') {
        // Type-only bindings have no value use for the use-scan to find, so
        // every named binding is collected without reading the deprecated flag.
        const bindings = node.importClause.namedBindings
        if (bindings !== undefined && ts.isNamespaceImport(bindings)) {
          namespaces.add(bindings.name.text)
        } else if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            const name = element.name.text
            const importedName = element.propertyName?.text ?? name
            if (SHELL_NAMES.has(importedName)) {
              shellUsed.push(name)
            } else if (SPAWN_NAMES.has(importedName)) {
              imported.add(name)
            } else if (importedName === LAUNCH_NAME) {
              launched.add(name)
            }
          }
        }
      } else if (/(^|\/)(process|launcher)$/u.test(specifier)) {
        const bindings = node.importClause.namedBindings
        if (bindings !== undefined && ts.isNamedImports(bindings)) {
          for (const element of bindings.elements) {
            if ((element.propertyName?.text ?? element.name.text) === LAUNCH_NAME) {
              launched.add(element.name.text)
            }
          }
        }
      }
    }
    if (
      ts.isVariableStatement(node) &&
      node.declarationList.declarations.some(
        (declaration) =>
          declaration.initializer !== undefined &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isIdentifier(declaration.initializer.expression) &&
          declaration.initializer.expression.text === 'require' &&
          declaration.initializer.arguments.some(
            (argument) => ts.isStringLiteral(argument) && argument.text === 'node:child_process',
          ),
      )
    ) {
      for (const declaration of node.declarationList.declarations) {
        if (
          declaration.initializer !== undefined &&
          ts.isCallExpression(declaration.initializer) &&
          ts.isObjectBindingPattern(declaration.name)
        ) {
          for (const element of declaration.name.elements) {
            if (ts.isIdentifier(element.name)) {
              if (SHELL_NAMES.has(element.name.text)) {
                shellUsed.push(element.name.text)
              } else if (SPAWN_NAMES.has(element.name.text)) {
                imported.add(element.name.text)
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visitImport)
  }
  visitImport(source)
  if (shellUsed.length > 0) {
    throw new Error(`${file} imports a shell-string starter: ${shellUsed.join(', ')}`)
  }
  const starts: SpawnSite[] = []
  const launches: SpawnSite[] = []
  const seen = new Set<string>()
  const flag = (into: SpawnSite[], node: ts.Node, name: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    const key = `${String(line)}:${name}`
    if (seen.has(key)) {
      return
    }
    seen.add(key)
    into.push({ line, name })
  }
  const isUse = (node: ts.Identifier): boolean => {
    const parent = node.parent
    const isDeclaration =
      ((ts.isImportSpecifier(parent) ||
        ts.isImportClause(parent) ||
        ts.isVariableDeclaration(parent)) &&
        parent.name === node) ||
      ts.isBindingElement(parent)
    const isPropertyName =
      (ts.isPropertyAssignment(parent) || ts.isPropertyAccessExpression(parent)) &&
      parent.name === node
    const isParameter = ts.isParameter(parent) && parent.name === node
    return !isDeclaration && !isPropertyName && !isParameter
  }
  // A direct start is any value use of an imported starter: a bare call, a
  // reference handed to another launcher (`spawn` into createGitProcess, an
  // `execFile` into promisify), or a namespaced call. A governed launch is
  // any value use of the imported `spawnResourceProcess`.
  const visitUse = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = node.expression
      if (
        ts.isPropertyAccessExpression(target) &&
        ts.isIdentifier(target.expression) &&
        namespaces.has(target.expression.text) &&
        SPAWN_NAMES.has(target.name.text)
      ) {
        flag(starts, node, target.name.text)
      }
    }
    if (ts.isIdentifier(node) && imported.has(node.text) && isUse(node)) {
      flag(starts, node, node.text)
    } else if (ts.isIdentifier(node) && launched.has(node.text) && isUse(node)) {
      flag(launches, node, node.text)
    }
    ts.forEachChild(node, visitUse)
  }
  visitUse(source)
  return { starts, launches }
}

/**
Bare calls of the process-start wrappers, literal or variable command
alike, including one-level aliases (`const exec = execResourceFile` in
the schedule git reader, `const execFileAsync = execResourceFile` in the
report history): an alias call is the same spawn under another name
(round 6: both aliases hid a governed start from the wrapper walk).
*/
function wrapperSpawns(file: string, text: string): SpawnSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const aliases = new Set<string>()
  const visitAlias = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer !== undefined &&
      ts.isIdentifier(node.initializer) &&
      (WRAPPER_NAMES.has(node.initializer.text) || aliases.has(node.initializer.text))
    ) {
      aliases.add(node.name.text)
    }
    ts.forEachChild(node, visitAlias)
  }
  visitAlias(source)
  const sites: SpawnSite[] = []
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      (WRAPPER_NAMES.has(node.expression.text) || aliases.has(node.expression.text))
    ) {
      const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
      sites.push({ line, name: node.expression.text })
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

/**
Template scripts that start a process of their own: a backtick literal
containing a `spawn(`/`execFile` call (the POSIX tree supervisor keeps
its child in `POSIX_TREE_SUPERVISOR`, where the import walk never sees
it). Tagged templates (`String.raw`) count too.
*/
function embeddedScripts(file: string, text: string): SpawnSite[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
  const sites: SpawnSite[] = []
  const flag = (node: ts.Node, name: string): void => {
    const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    sites.push({ line, name })
  }
  const visit = (node: ts.Node): void => {
    let literal: string | undefined
    if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) {
      literal = node.getText()
    } else if (ts.isTaggedTemplateExpression(node)) {
      literal = node.template.getText()
    }
    if (literal !== undefined && (literal.includes('spawn(') || literal.includes('execFile'))) {
      flag(node, 'embedded-spawn')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return sites
}

/**
The inventory, built once at import: walking and parsing the whole tree
takes seconds, far past a test's own budget, and the result cannot change
mid-suite. Every test reads these maps.
*/
const inventory = ((): {
  readonly starts: Map<string, SpawnSite[]>
  readonly launches: Map<string, SpawnSite[]>
  readonly wrappers: Map<string, SpawnSite[]>
  readonly scripts: Map<string, SpawnSite[]>
} => {
  const starts = new Map<string, SpawnSite[]>()
  const launches = new Map<string, SpawnSite[]>()
  const wrappers = new Map<string, SpawnSite[]>()
  const scripts = new Map<string, SpawnSite[]>()
  const root = path.join(__dirname, '..', '..')
  for (const file of walk(SRC)) {
    // Cheap prefilter: only a file that mentions child_process, the
    // governed launcher or a wrapper name can start a process; only those
    // pay for a parse. Embedded scripts are found on the same parse.
    const text = readFileSync(file, 'utf8')
    if (
      !text.includes('child_process') &&
      !text.includes(LAUNCH_NAME) &&
      [...WRAPPER_NAMES].every((name) => !text.includes(name))
    ) {
      continue
    }
    const relative = path.relative(root, file).replaceAll('\\', '/')
    const sites = directSpawns(file, text)
    if (sites.starts.length > 0) {
      starts.set(relative, sites.starts)
    }
    if (sites.launches.length > 0) {
      launches.set(relative, sites.launches)
    }
    const wrapperSites = wrapperSpawns(file, text)
    if (wrapperSites.length > 0) {
      wrappers.set(relative, wrapperSites)
    }
    const scriptSites = embeddedScripts(file, text)
    if (scriptSites.length > 0) {
      scripts.set(relative, scriptSites)
    }
  }
  return { starts, launches, wrappers, scripts }
})()

function checkInventory(
  found: Map<string, SpawnSite[]>,
  known: Record<string, KnownSpawn>,
  failure: string,
): void {
  const unknown: string[] = []
  for (const file of found.keys()) {
    if (known[file] === undefined) {
      unknown.push(file)
    }
  }
  const detail: string[] = []
  for (const file of unknown) {
    const sites = found.get(file) ?? []
    const named = Array.from(sites, (site) => `${site.name}:${String(site.line)}`)
    detail.push(`${file}: ${named.join(', ')}`)
  }
  expect(detail, failure).toEqual([])
  const missing: string[] = []
  for (const file of Object.keys(known)) {
    if (!found.has(file)) {
      missing.push(file)
    }
  }
  expect(missing, 'inventory entry with no start left: update the record').toEqual([])
}

function checkAnchors(known: Record<string, KnownSpawn>): void {
  const root = path.join(__dirname, '..', '..')
  const withoutAnchor: string[] = []
  for (const [file, entry] of Object.entries(known)) {
    if (!readFileSync(path.join(root, file), 'utf8').includes(entry.anchor)) {
      withoutAnchor.push(`${file} lost its ${entry.kind} anchor ${entry.anchor}`)
    }
  }
  expect(withoutAnchor, 'a guard was removed without updating the record').toEqual([])
}

describe('PATHGUARD spawn inventory', () => {
  it('every direct process start is guarded or reviewed', () => {
    checkInventory(
      inventory.starts,
      KNOWN,
      'unguarded process start: route it through the guarded lookup + child env, or review it into the record',
    )
  })

  it('every governed launch is guarded or reviewed', () => {
    checkInventory(
      inventory.launches,
      KNOWN_LAUNCH,
      'unguarded governed launch: route it through commands.ts, or review it into the record',
    )
  })

  it('every wrapper start is guarded or reviewed', () => {
    checkInventory(
      inventory.wrappers,
      KNOWN_WRAPPER,
      'unguarded wrapper start: resolve outside the workspace + guarded child env, or review it into the record',
    )
  })

  it('every embedded supervisor script is guarded or reviewed', () => {
    checkInventory(
      inventory.scripts,
      KNOWN_SCRIPT,
      'unguarded embedded spawn: spawn only a caller-resolved absolute command, or review it into the record',
    )
  })

  it('every listed mechanism is still wired', () => {
    checkAnchors(KNOWN)
    checkAnchors(KNOWN_LAUNCH)
    checkAnchors(KNOWN_WRAPPER)
    checkAnchors(KNOWN_SCRIPT)
  })

  it('forgetting the guard is a type error: lookups take a scope, spawns take a guarded env', () => {
    // The compiler enforces every call site (`npm run typecheck` lists what
    // breaks); this test pins the signatures the enforcement rests on, so
    // loosening one fails here too.
    const root = path.join(__dirname, '..', '..')
    const readSrc = (file: string): string => readFileSync(path.join(root, file), 'utf8')
    const executables = readSrc('src/core/executables.ts')
    expect(executables).toContain('readonly scope: ExecutableScope')
    expect(executables).toContain('NO_WORKSPACE')
    expect(executables).toContain('GuardedChildEnv')
    expect(readSrc('src/host/processTree.ts')).toContain('GuardedChildEnv')
    expect(readSrc('src/core/backends/modelapi/pluginHost.ts')).toContain('GuardedChildEnv')
    // The only producers of the branded environment (the guarded layer ships
    // beside activation; the scope brand stays with the types above).
    const guard = readSrc('src/core/execGuard.ts')
    expect(guard.match(/export function (workspace|noWorkspace)ChildEnvironment/g)).toEqual([
      'export function workspaceChildEnvironment',
      'export function noWorkspaceChildEnvironment',
    ])
  })

  it('round 7: every starter and every native payload takes only the branded env', () => {
    // The class closure: direct `spawn`/`execFile` live only behind the one
    // guarded wrapper, and a native helper payload serializes only from a
    // branded environment. Loosening any signature below reopens the
    // Windows-team-payload hole (a `string[]` the compiler could not see).
    const root = path.join(__dirname, '..', '..')
    const readSrc = (file: string): string => readFileSync(path.join(root, file), 'utf8')
    const wrapper = readSrc('src/core/guardedChildProcess.ts')
    expect(wrapper).toContain('readonly env: GuardedChildEnv')
    expect(wrapper).toContain('export function spawnGuarded')
    expect(wrapper).toContain('export function execFileGuarded')
    // Every process entry takes the brand: the governed launch, the job
    // payload, the serve spawn and the checkout port take it directly; the
    // git runner builds its own through the guarded layer's
    // `childGitEnvironment`, and the layer itself carries the brand.
    for (const file of [
      'src/core/resources/launch.ts',
      'src/host/backend/mcpJobLaunch.ts',
      'src/core/backends/musecode/MuseCodeHost.ts',
      'src/core/execGuard.ts',
      'src/runtime/panel/pullRequests/checkout.ts',
    ]) {
      expect(readSrc(file), `${file} takes the branded child env`).toContain('GuardedChildEnv')
    }
    expect(readSrc('src/host/git.ts')).toContain('childGitEnvironment')
    // Helper payloads serialize only from the brand.
    expect(readSrc('src/core/execGuard.ts')).toContain(
      'export function guardedEnvironmentBlock(env: GuardedChildEnv)',
    )
    expect(readSrc('src/host/team/processLifetime.ts')).toContain('guardedEnvironmentBlock(')
    // The only cast to the brand is its producer: a second `as
    // GuardedChildEnv` anywhere in src/ would launder a raw environment.
    const unbranded: string[] = []
    const sources = walk(path.join(root, 'src')).filter((file) => file.endsWith('.ts'))
    for (const file of sources) {
      const relative = path.relative(root, file).replaceAll('\\', '/')
      const casts = readFileSync(file, 'utf8').match(/as GuardedChildEnv/g) ?? []
      if (relative === 'src/core/execGuard.ts') {
        if (casts.length !== 1) unbranded.push(`${relative}: producer lost its single cast`)
      } else if (casts.length > 0) {
        unbranded.push(`${relative}: ${String(casts.length)} casts`)
      }
    }
    expect(unbranded, 'a raw environment laundered into the brand').toEqual([])
  })
})
