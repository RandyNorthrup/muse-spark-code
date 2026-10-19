// PATHGUARD spawn inventory (Grok re-review of PR #249): every direct
// child-process start and every raw governed launch in src/ is enumerated
// from the source itself and must either route through the guarded lookup +
// child environment or stand on the short reviewed lists below with its
// reason. Add an unguarded spawn and this suite fails; remove a guard and
// its anchor fails with it.
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

interface KnownSpawn {
  /** Guarded in this file, or reviewed with the reason below. */
  readonly kind: 'guarded' | 'reviewed'
  /** A string of the verified mechanism that must stay in the file. */
  readonly anchor: string
  readonly reason: string
}

const KNOWN: Record<string, KnownSpawn> = {
  'src/core/backends/modelapi/pluginHost.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: 'absolute runtime from resolvePluginRuntime (workspace excluded) + guarded child env',
  },
  'src/core/backends/musecode/MuseCodeHost.ts': {
    kind: 'guarded',
    anchor: 'spawnAccountMspConnection',
    reason:
      'absolute launch command from the manager resolveLaunch (workspace excluded) + guarded builder env',
  },
  'src/core/backends/musecode/sandbox.ts': {
    kind: 'guarded',
    anchor: 'resolveExecutable',
    reason:
      'bwrap probe resolved off absolute PATH entries only; a binary inside the workspace is refused before spawning',
  },
  'src/core/locks/processOwner.ts': {
    kind: 'reviewed',
    anchor: '/bin/ps',
    reason: 'fixed /bin/ps and SystemRoot powershell only, no shell, no workspace cwd',
  },
  'src/core/eval/workspace.ts': {
    kind: 'reviewed',
    anchor: 'process.execPath',
    reason: 'fixed process.execPath verifier + empty env',
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
  'src/core/resources/process.ts': {
    kind: 'guarded',
    anchor: 'ResourceLaunchProfile',
    reason:
      'the one governed launch: file + env supplied by commands.ts resolveCommand + child env',
  },
  'src/core/resources/trees/run.ts': {
    kind: 'reviewed',
    anchor: 'runTreeProgram',
    reason: 'callers pass absolute OS/native-helper paths only',
  },
  'src/core/resources/trees/linuxLaunch.ts': {
    kind: 'reviewed',
    anchor: '/usr/bin/systemd-run',
    reason: 'fixed /usr/bin/systemd-run and /bin/sh only',
  },
  'src/core/resources/sampler/system.ts': {
    kind: 'reviewed',
    anchor: 'RESOURCE_PROBE_EMPTY_ENV_KEYS',
    reason: 'absolute paths only + near-empty env',
  },
  'src/core/team/workers/workerFence.ts': {
    kind: 'reviewed',
    anchor: '/usr/sbin/lsof',
    reason: 'fixed /usr/sbin/lsof + scrubbed env',
  },
  'src/host/voice/voiceProcesses.ts': {
    kind: 'reviewed',
    anchor: 'helperEnvironment',
    reason: 'absolute helper/recorder command from the guarded lookup, no shell',
  },
  'src/host/git.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: 'git resolved outside the run directory (links followed) + guarded child env',
  },
  'src/host/backend/mcpJobLaunch.ts': {
    kind: 'reviewed',
    anchor: 'launch.executablePath',
    reason: 'digest-named packaged job launcher only, never PATH-resolved',
  },
  'src/host/backend/mcpProcess.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: 'absolute server file (bare names exclude the server directory) + guarded child env',
  },
  'src/host/backend/toolIo.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: 'absolute interpreter + guarded shell/hook envs for the run directory',
  },
  'src/host/team/processLifetime.ts': {
    kind: 'guarded',
    anchor: 'workspaceChildEnvironment',
    reason: "person's team command + guarded child env for its cwd; absolute powershell on Windows",
  },
  'src/host/processTree.ts': {
    kind: 'reviewed',
    anchor: '/bin/ps',
    reason:
      'fixed /bin/ps and process.execPath supervisor; runProgram callers pass absolute system paths (systemctl probes run with the host cwd, never a workspace cwd)',
  },
  'src/host/browser/browserProcess.ts': {
    kind: 'reviewed',
    anchor: 'WINDOWS_TASKKILL_RELATIVE_PATH',
    reason: 'pinned runtime verified against browserRuntime.json + SystemRoot taskkill only',
  },
  'src/host/resources/resourceJobHolder.ts': {
    kind: 'reviewed',
    anchor: 'WINDOWS_POWERSHELL_COMMAND_ARGS',
    reason: 'absolute SystemRoot powershell + packaged job assembly only',
  },
  'src/runtime/panel/pullRequests/checkout.ts': {
    kind: 'reviewed',
    anchor: 'GitProcessPort',
    reason: 'thin wrapper: the caller hands the absolute git only',
  },
  'src/runtime/panel/git/service.ts': {
    kind: 'guarded',
    anchor: 'fixedGitLocator',
    reason: 'hands spawn + links into createGitProcess with the bound-root-refusing locator',
  },
  'src/host/estimator/planSnapshotSource.ts': {
    kind: 'guarded',
    anchor: 'resolveExecutable',
    reason: 'gh/git resolved through the guarded lookup; scrubbed env, bounded output',
  },
  'src/host/media/recordingLatest.ts': {
    kind: 'reviewed',
    anchor: 'System32',
    reason: 'absolute System32 powershell/icacls only, no shell, hidden window',
  },
  'src/runtime/converterTrust.ts': {
    kind: 'reviewed',
    anchor: 'systemPowerShell',
    reason: 'absolute System32 powershell only (verifier-selected), scrubbed env, no shell',
  },
  'src/runtime/vault/windowsPipeRelay.ts': {
    kind: 'reviewed',
    anchor: 'verifyWindowsVaultFileSync',
    reason: 'digest-pinned helper verified before the one-shot sync start; SystemRoot-only env',
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
 * The inventory, built once at import: walking and parsing the whole tree
 * takes seconds, far past a test's own budget, and the result cannot change
 * mid-suite. Every test reads these two maps.
 */
const inventory = ((): {
  readonly starts: Map<string, SpawnSite[]>
  readonly launches: Map<string, SpawnSite[]>
} => {
  const starts = new Map<string, SpawnSite[]>()
  const launches = new Map<string, SpawnSite[]>()
  const root = path.join(__dirname, '..', '..')
  for (const file of walk(SRC)) {
    // Cheap prefilter: only a file that mentions child_process or the
    // governed launcher can start a process; only those pay for a parse.
    const text = readFileSync(file, 'utf8')
    if (!text.includes('child_process') && !text.includes(LAUNCH_NAME)) {
      continue
    }
    const sites = directSpawns(file, text)
    const relative = path.relative(root, file).replaceAll('\\', '/')
    if (sites.starts.length > 0) {
      starts.set(relative, sites.starts)
    }
    if (sites.launches.length > 0) {
      launches.set(relative, sites.launches)
    }
  }
  return { starts, launches }
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

  it('every listed mechanism is still wired', () => {
    checkAnchors(KNOWN)
    checkAnchors(KNOWN_LAUNCH)
  })
})
