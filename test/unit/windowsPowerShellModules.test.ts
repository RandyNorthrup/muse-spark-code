// WINPSMOD (0.19.0): Windows PowerShell 5.1 children and PowerShell 7's
// module path. VS Code or the agent started from a PowerShell 7 terminal
// inherits pwsh 7's `PSModulePath`, which lists pwsh 7's copies of the core
// modules first; a powershell.exe child then fails to autoload them and every
// cmdlet they hold fails. One rule in the guarded layer,
// `windowsPowerShellEnvironment`, gives each 5.1 child Windows PowerShell's
// own module path.
//
// The gate below enumerates, from the source itself, every file in src/ whose
// code names Windows PowerShell 5.1's program (a `powershell.exe` or
// `WindowsPowerShell` literal, or the two path constants): each must apply
// the rule (call it, or a guarded-layer function the last test pins to it),
// or stand on the short reviewed list with its reason. A new powershell.exe
// start that skips the rule fails the first test; a removed rule fails with
// its anchor. The real process comes after: the agent's owner-only lockdown
// in Windows PowerShell 5.1 under pwsh 7's real module path.
import { execFileSync } from 'node:child_process'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { readdirSync, readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { secureOwnerOnly } from '../../src/runtime/tokenFile'
import { withPowerShell7ModulePath } from './helpers/powerShell7'

const ROOT = path.join(__dirname, '..', '..')
const SRC = path.join(ROOT, 'src')

/** The rule itself, and the guarded-layer functions that apply it. */
const RULE = 'windowsPowerShellEnvironment'
const RULE_CARRIERS = ['windowsPowerShell', 'shellEnvironment', 'buildChildEnvironment'] as const
const APPLIES_RULE: ReadonlySet<string> = new Set([RULE, ...RULE_CARRIERS])

/** A literal naming Windows PowerShell 5.1's program or its folder. */
const NAMES_PROGRAM = /powershell\.exe|WindowsPowerShell/iu
const PATH_CONSTANTS: ReadonlySet<string> = new Set([
  'WINDOWS_POWERSHELL_RELATIVE_PATH',
  'WINDOWS_POWERSHELL_TERMINAL_PATH',
])

interface Reviewed {
  /** A string of the reviewed mechanism that must stay in the file. */
  readonly anchor: string
  readonly reason: string
}

const REVIEWED: Record<string, Reviewed> = {
  'src/shared/constants.ts': {
    anchor: 'WINDOWS_PSMODULEPATH_SEGMENTS',
    reason: "the path constants' declarations and the rule's module folders, no process start",
  },
  'src/core/backends/musecode/sandbox.ts': {
    anchor: 'CliInvocation',
    reason:
      "the UAC relaunch's invocation only: its caller runs it in the backend's child environment, which buildChildEnvironment builds",
  },
  'src/runtime/windowsTrustedPath.ts': {
    anchor: 'run: (file: string, args: readonly string[])',
    reason:
      'names the program for its injected runner: converterTrust and backgroundProcessRunner start it through windowsPowerShell',
  },
  'src/runtime/schedules/effectiveDefinition.ts': {
    anchor: 'readonly run: (file: string, args: readonly string[])',
    reason: 'names the program for the injected backgroundProcessRunner (windowsPowerShell)',
  },
  'src/runtime/schedules/nativeBackground.ts': {
    anchor: 'readonly run: (file: string, args: readonly string[])',
    reason: 'names the program for the injected backgroundProcessRunner (windowsPowerShell)',
  },
  'src/core/backends/modelapi/foreignHooksEntry.ts': {
    anchor: 'hookEnvironment',
    reason:
      "an imported hook's command line for cmd.exe: the hook environment is an allowlist that carries no PSModulePath",
  },
  'src/host/runners/sshRunner.ts': {
    anchor: '-EncodedCommand',
    reason: "a command line for the remote Windows host's own shell, over ssh",
  },
}

function isLiteral(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateHead(node) ||
    ts.isTemplateMiddle(node) ||
    ts.isTemplateTail(node)
  )
}

function calledName(node: ts.CallExpression): string | undefined {
  const target = node.expression
  if (ts.isIdentifier(target)) return target.text
  return ts.isPropertyAccessExpression(target) ? target.name.text : undefined
}

interface Site {
  /** Lines that name the program. */
  readonly names: readonly number[]
  readonly isRuleApplied: boolean
}

/** Built once at import: walking and parsing src/ takes longer than one test's budget. */
const sites = ((): Map<string, Site> => {
  const found = new Map<string, Site>()
  const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.ts'))
    .map((name) => path.join(SRC, name))
  for (const file of sources) {
    const text = readFileSync(file, 'utf8')
    if (!/powershell/iu.test(text)) continue
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true)
    const names: number[] = []
    let isRuleApplied = false
    const line = (node: ts.Node) => source.getLineAndCharacterOfPosition(node.getStart()).line + 1
    const visit = (node: ts.Node): void => {
      // The literal as written (`String.raw` keeps `\v1.0` as it stands).
      if (isLiteral(node) && NAMES_PROGRAM.test(node.getText())) names.push(line(node))
      if (ts.isIdentifier(node) && PATH_CONSTANTS.has(node.text)) names.push(line(node))
      if (ts.isCallExpression(node) && APPLIES_RULE.has(calledName(node) ?? ''))
        isRuleApplied = true
      ts.forEachChild(node, visit)
    }
    visit(source)
    if (names.length > 0) {
      found.set(path.relative(ROOT, file).replaceAll('\\', '/'), { names, isRuleApplied })
    }
  }
  return found
})()

/** The body of the function `name` declares in `file`, parsed. */
function functionBody(file: string, name: string): ts.Block | undefined {
  const source = ts.createSourceFile(
    file,
    readFileSync(path.join(ROOT, file), 'utf8'),
    ts.ScriptTarget.Latest,
    true,
  )
  let body: ts.Block | undefined
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) body = node.body
    ts.forEachChild(node, visit)
  }
  visit(source)
  return body
}

function hasRuleCall(body: ts.Node | undefined): boolean {
  let isCalled = false
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calledName(node) === RULE) isCalled = true
    ts.forEachChild(node, visit)
  }
  if (body !== undefined) visit(body)
  return isCalled
}

describe('WINPSMOD Windows PowerShell 5.1 children', () => {
  it('every file that names Windows PowerShell 5.1 applies the rule or is reviewed', () => {
    const unruled: string[] = []
    for (const [file, site] of sites) {
      if (!site.isRuleApplied && REVIEWED[file] === undefined)
        unruled.push(`${file}: line ${site.names.join(', ')}`)
    }
    expect(
      unruled,
      `a Windows PowerShell 5.1 start without ${RULE}: apply it, or review it into the record`,
    ).toEqual([])
  })

  it('every reviewed file still names the program and keeps its anchor', () => {
    const stale: string[] = []
    for (const [file, entry] of Object.entries(REVIEWED)) {
      if (!sites.has(file)) stale.push(`${file} no longer names Windows PowerShell 5.1`)
      else if (!readFileSync(path.join(ROOT, file), 'utf8').includes(entry.anchor))
        stale.push(`${file} lost its anchor ${entry.anchor}`)
    }
    expect(stale, 'update the reviewed record').toEqual([])
  })

  it("the guarded layer's carriers, and the vault helper's start, apply the rule", () => {
    const missing: string[] = []
    for (const carrier of RULE_CARRIERS) {
      if (!hasRuleCall(functionBody('src/core/execGuard.ts', carrier))) missing.push(carrier)
    }
    // The vault helper record's PowerShell path is made by windowsPowerShell
    // (windowsVaultBuild.ts) and started only here, under the broker.
    if (
      !hasRuleCall(
        functionBody('src/runtime/vault/slots/windowsVaultTransport.ts', 'spawnGuardedVaultHelper'),
      )
    )
      missing.push('spawnGuardedVaultHelper')
    expect(missing, `each must call ${RULE}`).toEqual([])
  })
})

// The agent's owner-only lockdown (the bearer token's folder, conversion's
// private folder: runtime/tokenFile.ts) runs Get-Acl and Set-Acl, which
// Microsoft.PowerShell.Security holds, in Windows PowerShell 5.1. With this
// process carrying pwsh 7's real module path, as an agent started from a
// PowerShell 7 terminal has it, the folder is still locked down; without the
// rule 5.1 cannot load either cmdlet and the lockdown refuses.
describe.runIf(process.platform === 'win32')(
  'WINPSMOD owner-only lockdown from a PowerShell 7 terminal',
  () => {
    it('locks a real folder to its owner through Windows PowerShell 5.1', async () => {
      const folder = await mkdtemp(path.join(await realpath(os.tmpdir()), 'winpsmod-'))
      try {
        const receipt = await withPowerShell7ModulePath(() => secureOwnerOnly(folder, 'directory'))
        expect(receipt.ownerOnly).toBe(true)
        // Read back independently: one grant, nothing inherited.
        const systemRoot = process.env['SystemRoot'] ?? ''
        const icacls = execFileSync(path.join(systemRoot, 'System32', 'icacls.exe'), [folder], {
          encoding: 'utf8',
        })
        const grants = icacls
          .split(/\r?\n/u)
          .map((line) => line.replace(folder, '').trim())
          .filter((line) => line.includes(':('))
        expect(grants).toHaveLength(1)
        expect(grants[0]).toMatch(/:\(OI\)\(CI\)\(F\)$/u)
      } finally {
        await rm(folder, { recursive: true, force: true })
      }
    })
  },
)
