import { describe, expect, it } from 'vitest'
import { parseInspectCommand } from '../../src/core/judge/fast/inspectGrammar'
import { inspectPathSpellings, inspectProtectedPaths } from './helpers/inspectPaths'

describe('B1 positive command grammar', () => {
  it.each([
    ['ls -laRh .', 'ls', true],
    ["cat -n 'src/a file.ts'", 'cat', false],
    ['head -n 20 src/a.ts', 'head', false],
    ['tail -c 100 src/a.ts', 'tail', false],
    ['wc -lwcm src/a.ts', 'wc', false],
    ['stat src/a.ts', 'stat', false],
    ['stat -- src/a.ts', 'stat', false],
    ['du -sh --max-depth=2 .', 'du', true],
    ["grep -rni -e 'url.*' '--include=*.ts' .", 'grep', true],
    ["find src -name '*.ts' -type f -a -size +1 -print", 'find', true],
    ['ls', 'ls', false],
    ["grep -r 'url'", 'grep', true],
  ])('admits %s', (line, program, isRecursive) => {
    expect(parseInspectCommand(line, 'linux')).toMatchObject({ program, recursive: isRecursive })
  })

  it.each([
    'cat src/a.ts > out',
    'cat src/a.ts | wc',
    'cat $(pwd)',
    'cat `pwd`',
    'cat $HOME',
    'cat ~/x',
    'cat src/*.ts',
    'cat "src/a.ts"',
    'cat ../outside',
    'cat /etc/passwd',
    String.raw`cat C:\outside`,
    String.raw`cat src\a.ts`,
    'cat .git/config',
    'cat pkg/.git/config',
    'cat .claude/settings.json',
    'cat config/.env.production',
    'cat certs/dev.pem',
    'cat AGENTS.md',
    'cat id_rsa',
    'cat .env',
    "cat 'password=synthetic-sensitive-canary'",
    'find . -delete',
    'find . -exec cat {} +',
    'find . -fprint out',
    'find -L .',
    'find . -follow',
    'find . -ok cat {} ;',
    'tail -f x',
    'tail --follow x',
    'grep -R x .',
    'grep -f x .',
    'grep -D read x .',
    'grep --unknown x .',
    'stat --format x .',
    'ls --force .',
    'git status',
    'rg x .',
    '/usr/local/bin/cat x',
    './bin/cat x',
    'sudo cat x',
    "cat 'x'word",
    "cat 'unterminated",
    'cat a\nls',
    'head -n -1 x',
    'cat',
    'wc',
    'grep x',
    'du -d 2 .',
  ])('refuses %s', (line) => {
    expect(parseInspectCommand(line, 'linux')).toBeUndefined()
  })

  it('separates GNU/BSD depth options and refuses Windows', () => {
    expect(parseInspectCommand('du -d 2 .', 'darwin')).toMatchObject({ recursive: true })
    expect(parseInspectCommand('du --max-depth=2 .', 'darwin')).toBeUndefined()
    expect(parseInspectCommand('cat x', 'win32')).toBeUndefined()
  })

  it('refuses every protected/private path under seeded dot, dotdot, separator and case insertions', () => {
    for (const platform of ['linux', 'darwin'] as const) {
      for (const protectedPath of inspectProtectedPaths) {
        for (const canonical of [protectedPath, `pkg/${protectedPath}/probe.txt`]) {
          for (const spelling of inspectPathSpellings(canonical)) {
            for (const operand of [
              spelling,
              spelling.toUpperCase(),
              spelling.replaceAll('/', '\\'),
            ]) {
              expect(parseInspectCommand(`cat '${operand}'`, platform), operand).toBeUndefined()
            }
          }
        }
      }
    }
  })
  it('drops the stat operand separator so tool arguments mirror operands', () => {
    expect(parseInspectCommand('stat -- src/a.ts', 'linux')).toMatchObject({
      args: ['src/a.ts'],
      operands: ['src/a.ts'],
    })
  })
  it('uses canonical operands in grant and tool argv without changing patterns or relaxing the floor', () => {
    expect(parseInspectCommand("grep -r -e './pattern' .github/.", 'linux')).toMatchObject({
      args: ['-r', '-e', './pattern', '.github'],
      operands: ['.github'],
    })
    expect(parseInspectCommand('cat ./src/./a.ts', 'linux')).toMatchObject({
      args: ['src/a.ts'],
      operands: ['src/a.ts'],
    })
    expect(parseInspectCommand('cat .github/./workflows-extra/a.ts', 'linux')).toMatchObject({
      operands: ['.github/workflows-extra/a.ts'],
    })
    for (const operand of ['src/../a.ts', 'src//a.ts', 'src/a.ts/', './-n', './C:/outside']) {
      expect(parseInspectCommand(`cat ${operand}`, 'linux'), operand).toBeUndefined()
    }
  })
})
