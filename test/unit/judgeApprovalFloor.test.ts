// M125 lane F1b: the B1 floor and its shared conditions. Every
// §9.3.2 floor hit routes to the reviewer with its named reason, the
// grammar catch-all behind the explicit names, and a pass carries the
// canonical line the grant sends. Eligibility pins the platform gate
// (empty until a receipt and the harm bound land), Auto-only mode,
// and the live conditions. The confinement itself is F1a's, proven
// there; the drills run it in docs/certification/m125-f1.md.
import { realpathSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { ApprovalMode } from '../../src/shared/permissionModes'
import { JUDGE_FAST_B1_READY_PLATFORMS } from '../../src/shared/constants'
import {
  b1Eligible,
  b1Floor,
  b1ProgramPath,
  canonicalB1Line,
  resolveB1Executable,
  type B1Conditions,
  type B1FloorContext,
} from '../../src/core/judge/fast/approval'
import { parseInspectCommand } from '../../src/core/judge/fast/inspectGrammar'

const SECRET_CANARY = 'password = "synthetic-sensitive-canary"'

function quotedWords(group: string): string[] {
  const words: string[] = []
  for (const match of group.matchAll(/"([^"]*)"/gu)) {
    if (match[1] !== undefined && match[1] !== '') words.push(match[1])
  }
  return words
}

function missingRealpath(): string {
  throw Object.assign(new Error('no such file'), { code: 'ENOENT', errno: -2 })
}

function brokenRealpath(): string {
  throw new Error('boom')
}

function floorContext(overrides: Partial<B1FloorContext> = {}): B1FloorContext {
  return {
    settledBy: undefined,
    tool: { network: false, paid: false, spawn: false, mcpWrite: false },
    confidentialNonlocal: false,
    ...overrides,
  }
}

function conditions(overrides: Partial<B1Conditions> = {}): B1Conditions {
  return {
    mode: 'onRequest',
    isHeadlessRun: false,
    isUntrustedOrigin: false,
    isWorkspaceTrusted: true,
    sessionProcessAlive: false,
    confinementReady: true,
    platform: 'linux',
    certifiedPlatforms: ['linux'],
    ...overrides,
  }
}

describe('B1 floor', () => {
  it('fails settled rules first, even for an innocent line', () => {
    expect(b1Floor('cat allowed.txt', floorContext({ settledBy: 'forbidRule' }))).toEqual({
      pass: false,
      reason: 'forbidRule',
    })
    expect(b1Floor('cat allowed.txt', floorContext({ settledBy: 'askRule' }))).toEqual({
      pass: false,
      reason: 'askRule',
    })
  })

  it('names evaluators, sudo, installs and git', () => {
    for (const line of ['eval danger', 'iex danger']) {
      expect(b1Floor(line, floorContext()).reason).toBe('evaluator')
    }
    expect(b1Floor('pwsh -EncodedCommand eAAn', floorContext()).reason).toBe('evaluator')
    expect(b1Floor('pwsh -encodedcommand eAAn', floorContext()).reason).toBe('evaluator')
    expect(b1Floor('sudo cat secrets.txt', floorContext()).reason).toBe('sudo')
    expect(b1Floor('git status', floorContext()).reason).toBe('gitCommand')
    for (const line of ['npm install', 'pnpm add leftpad', 'apt remove vim', 'brew upgrade']) {
      expect(b1Floor(line, floorContext()).reason).toBe('packageInstall')
    }
  })

  it('names --force anywhere in the line', () => {
    expect(b1Floor('find . --force -print', floorContext()).reason).toBe('forceFlag')
    expect(b1Floor('cat --force=x allowed.txt', floorContext()).reason).toBe('forceFlag')
    // A pattern merely containing the letters is not the flag.
    const innocent = b1Floor('grep -e forceful allowed.txt', floorContext())
    expect(innocent.pass).toBe(true)
  })

  it('fails the tool context and confidential routing', () => {
    const line = 'cat allowed.txt'
    expect(
      b1Floor(
        line,
        floorContext({ tool: { network: true, paid: false, spawn: false, mcpWrite: false } }),
      ).reason,
    ).toBe('networkTool')
    expect(
      b1Floor(
        line,
        floorContext({ tool: { network: false, paid: true, spawn: false, mcpWrite: false } }),
      ).reason,
    ).toBe('paidTool')
    expect(
      b1Floor(
        line,
        floorContext({ tool: { network: false, paid: false, spawn: true, mcpWrite: false } }),
      ).reason,
    ).toBe('spawnTool')
    expect(
      b1Floor(
        line,
        floorContext({ tool: { network: false, paid: false, spawn: false, mcpWrite: true } }),
      ).reason,
    ).toBe('mcpWrite')
    expect(b1Floor(line, floorContext({ confidentialNonlocal: true })).reason).toBe(
      'confidentialNonlocal',
    )
  })

  it('falls through to grammar for syntax, paths, programs and options', () => {
    const lines = [
      'cat allowed.txt | grep x',
      'cat allowed.txt > out.txt',
      'cat /etc/passwd',
      'cat ../outside.txt',
      'cat .env',
      'cat .git/config',
      'cat secrets.pem',
      `grep -e '${SECRET_CANARY}' src`,
      'rg pattern .',
      'tree .',
      'cat -z allowed.txt',
      'tail -f allowed.txt',
      'find . -exec echo {} ;',
      '',
    ]
    for (const line of lines) {
      expect(b1Floor(line, floorContext(), 'linux')).toEqual({ pass: false, reason: 'grammar' })
    }
  })

  it('refuses Windows at the floor', () => {
    expect(b1Floor('cat allowed.txt', floorContext(), 'win32')).toEqual({
      pass: false,
      reason: 'grammar',
    })
  })

  it('passes clean lines with the parse and the canonical line', () => {
    const cat = b1Floor('cat allowed.txt', floorContext(), 'linux')
    expect(cat.pass).toBe(true)
    if (cat.pass) {
      expect(cat.parsed.program).toBe('cat')
      expect(cat.parsed.operands).toEqual(['allowed.txt'])
      expect(cat.canonical).toBe('cat allowed.txt')
    }
    const quoted = b1Floor("cat 'my file.txt'", floorContext(), 'linux')
    if (quoted.pass) expect(quoted.canonical).toBe("cat 'my file.txt'")
    else expect.unreachable('quoted operand should pass')
    const recursive = b1Floor('grep -r -e url src', floorContext(), 'linux')
    if (recursive.pass) {
      expect(recursive.parsed.recursive).toBe(true)
      expect(recursive.canonical).toBe('grep -r -e url src')
    } else expect.unreachable('recursive grep should pass')
  })

  it('round-trips the canonical line through the grammar', () => {
    const lines = [
      'cat allowed.txt',
      "cat 'my file.txt'",
      'ls -l -a src',
      'head -n 10 allowed.txt',
      'tail -c 99 allowed.txt',
      'wc -l allowed.txt',
      'stat allowed.txt',
      'du -s --max-depth=2 src',
      'grep -r -n -e url src',
      "grep '--include=*.ts' -e main src",
      "find src -name '*.ts' -print",
    ]
    for (const line of lines) {
      const first = parseInspectCommand(line, 'linux')
      expect(first).toBeDefined()
      if (first === undefined) continue
      expect(parseInspectCommand(canonicalB1Line(first), 'linux')).toEqual(first)
    }
  })
})

describe('B1 program table', () => {
  it('maps the eight execed programs to the helper fixed paths', () => {
    expect(b1ProgramPath('ls')).toBe('/bin/ls')
    expect(b1ProgramPath('cat')).toBe('/bin/cat')
    expect(b1ProgramPath('head')).toBe('/usr/bin/head')
    expect(b1ProgramPath('tail')).toBe('/usr/bin/tail')
    expect(b1ProgramPath('wc')).toBe('/usr/bin/wc')
    expect(b1ProgramPath('du')).toBe('/usr/bin/du')
    expect(b1ProgramPath('grep')).toBe('/bin/grep')
    expect(b1ProgramPath('find')).toBe('/usr/bin/find')
    expect(b1ProgramPath('stat')).toBeUndefined()
    expect(b1ProgramPath('rg')).toBeUndefined()
  })

  it('matches the C helper table it mirrors, pair for pair', async () => {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
    const source = await readFile(
      path.join(root, 'native', 'confine', 'MuseSparkConfine.c'),
      'utf8',
    )
    const names = /static const char \*names\[\] = \{([^}]*)\}/u.exec(source)
    const paths = /static const char \*paths\[\] = \{([^}]*)\}/u.exec(source)
    expect(names?.[1]).toBeDefined()
    expect(paths?.[1]).toBeDefined()
    const cNames = quotedWords(names?.[1] ?? '')
    const cPaths = quotedWords(paths?.[1] ?? '')
    expect(cNames.length).toBe(cPaths.length)
    expect(cNames.length).toBeGreaterThan(0)
    for (const [index, name] of cNames.entries()) {
      expect(b1ProgramPath(name)).toBe(cPaths[index])
    }
  })

  it('resolves through realpath and audits the missing as absent', () => {
    const resolved = resolveB1Executable('cat', realpathSync)
    expect(resolved?.endsWith('/cat')).toBe(true)
    expect(resolveB1Executable('stat', realpathSync)).toBeUndefined()
    expect(resolveB1Executable('cat', missingRealpath)).toBeUndefined()
    expect(() => resolveB1Executable('cat', brokenRealpath)).toThrow('boom')
  })
})

describe('B1 shared conditions', () => {
  it('stays off everywhere until a receipt and the harm bound land', () => {
    expect(JUDGE_FAST_B1_READY_PLATFORMS).toEqual([])
    expect(b1Eligible(conditions({ certifiedPlatforms: [] }))).toEqual({
      eligible: false,
      reason: 'uncertifiedPlatform',
    })
  })

  it('admits a certified platform once both land', () => {
    expect(b1Eligible(conditions())).toEqual({ eligible: true })
  })

  it('is Auto-only and trusted, foreground, first-party company', () => {
    const modes: ApprovalMode[] = ['allowAll', 'promptUnmatched', 'denyUnmatched']
    for (const mode of modes) {
      expect(b1Eligible(conditions({ mode }))).toEqual({ eligible: false, reason: 'mode' })
    }
    expect(b1Eligible(conditions({ isHeadlessRun: true }))).toEqual({
      eligible: false,
      reason: 'headless',
    })
    expect(b1Eligible(conditions({ isUntrustedOrigin: true }))).toEqual({
      eligible: false,
      reason: 'untrustedOrigin',
    })
    expect(b1Eligible(conditions({ isWorkspaceTrusted: false }))).toEqual({
      eligible: false,
      reason: 'untrustedWorkspace',
    })
  })

  it('needs a quiet session and a ready confinement', () => {
    expect(b1Eligible(conditions({ sessionProcessAlive: true }))).toEqual({
      eligible: false,
      reason: 'sessionProcess',
    })
    expect(b1Eligible(conditions({ confinementReady: false }))).toEqual({
      eligible: false,
      reason: 'confinement',
    })
  })
})
