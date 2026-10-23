// M125 lane F2: the B2 command and script grammars, the fail-closed
// walk, the named-file rule and the closure digests, over the real
// module with controlled file answers on the documented ports.
import { describe, expect, it } from 'vitest'
import {
  b2WordCandidates,
  collectB2Candidates,
  collectB2Closure,
  digestB2Closure,
  digestB2Invocation,
  parseB2Command,
  parseB2PackageJson,
  parseB2ScriptText,
  pinB2Files,
  walkB2Scripts,
  type B2FileAnswers,
} from '../../src/core/judge/fast/b2Closure'

function answers(files: Readonly<Record<string, string>>): B2FileAnswers {
  return {
    statEntry: (relative) => (files[relative] === undefined ? 'other' : 'file'),
    readEntryBytes: (relative) => {
      const body = files[relative]
      return body === undefined ? undefined : new TextEncoder().encode(body)
    },
    readEntryLink: () => undefined,
  }
}

describe('B2 command grammar', () => {
  it('admits the four shapes with no option', () => {
    expect(parseB2Command('npm test')).toEqual({
      ok: true,
      command: { manager: 'npm', script: 'test', filters: [] },
    })
    expect(parseB2Command('npm run lint')).toEqual({
      ok: true,
      command: { manager: 'npm', script: 'lint', filters: [] },
    })
    expect(parseB2Command('pnpm typecheck')).toEqual({
      ok: true,
      command: { manager: 'pnpm', script: 'typecheck', filters: [] },
    })
    expect(parseB2Command('pnpm run format:check')).toEqual({
      ok: true,
      command: { manager: 'pnpm', script: 'format:check', filters: [] },
    })
  })

  it('admits path filters after a separator', () => {
    expect(parseB2Command('npm test -- src/a.test.ts src/b.test.ts')).toEqual({
      ok: true,
      command: { manager: 'npm', script: 'test', filters: ['src/a.test.ts', 'src/b.test.ts'] },
    })
  })

  it('refuses other commands, scripts and options', () => {
    expect(parseB2Command('yarn test')).toEqual({ ok: false, reason: 'notCheckCommand' })
    expect(parseB2Command('npm run')).toEqual({ ok: false, reason: 'notCheckCommand' })
    expect(parseB2Command('npm run deploy')).toEqual({ ok: false, reason: 'unknownScript' })
    expect(parseB2Command('npm test --watch')).toEqual({ ok: false, reason: 'option' })
    expect(parseB2Command('npm run lint extra')).toEqual({ ok: false, reason: 'option' })
  })

  it('refuses options and escaping paths as filters', () => {
    expect(parseB2Command('npm test -- --globalSetup=./x.js')).toEqual({
      ok: false,
      reason: 'filterOption',
    })
    expect(parseB2Command('npm test -- -u')).toEqual({ ok: false, reason: 'filterOption' })
    expect(parseB2Command('npm test -- ../outside.test.ts')).toEqual({
      ok: false,
      reason: 'filterPath',
    })
    expect(parseB2Command('npm test -- /abs.test.ts')).toEqual({
      ok: false,
      reason: 'filterPath',
    })
  })
})

describe('B2 script grammar', () => {
  it('admits joined commands, quotes and assignments', () => {
    const parsed = parseB2ScriptText('NODE_ENV=test vitest run && eslint . || echo "done now"')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands).toHaveLength(3)
    expect(parsed.commands[0]).toEqual({
      assigns: ['NODE_ENV=test'],
      words: ['vitest', 'run'],
    })
    expect(parsed.commands[2]).toEqual({ assigns: [], words: ['echo', 'done now'] })
  })

  it('refuses shells it does not model', () => {
    for (const text of [
      'a; b',
      'a | b',
      'a ||| b',
      'a &&& b',
      'a & b',
      'a > out',
      'echo $HOME',
      'echo `date`',
      'echo (x)',
      'ls *.ts',
      'echo ~',
      'echo # hi',
      'echo a\nb',
      '',
      ' '.repeat(3),
      'FOO=bar',
      '&& a',
      'a &&',
      "echo 'open",
      "echo ''",
    ]) {
      expect(parseB2ScriptText(text).ok, text).toBe(false)
    }
  })

  it('keeps quoted assignments literal', () => {
    const parsed = parseB2ScriptText("echo 'FOO=bar'")
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.commands[0]).toEqual({ assigns: [], words: ['echo', 'FOO=bar'] })
  })
})

describe('B2 script walk', () => {
  it('reaches the entry with its hooks and nested scripts', () => {
    const walked = walkB2Scripts(
      {
        test: 'npm run unit && npm run lint',
        pretest: 'node scripts/pre.js',
        posttest: 'node scripts/post.js',
        unit: 'vitest run',
        lint: 'eslint .',
      },
      'test',
    )
    expect(walked.ok).toBe(true)
    if (!walked.ok) return
    expect(walked.reached.map((script) => script.name)).toEqual([
      'pretest',
      'test',
      'unit',
      'lint',
      'posttest',
    ])
  })

  it('refuses cycles, depth, selections and other subcommands', () => {
    expect(walkB2Scripts({ a: 'npm run b', b: 'npm run a' }, 'a')).toMatchObject({
      ok: false,
      reason: 'scriptCycle',
    })
    expect(
      walkB2Scripts(
        {
          s0: 'npm run s1',
          s1: 'npm run s2',
          s2: 'npm run s3',
          s3: 'npm run s4',
          s4: 'npm run s5',
          s5: 'vitest',
        },
        's0',
      ),
    ).toMatchObject({ ok: false, reason: 'tooDeep' })
    expect(walkB2Scripts({ test: 'npm run check --workspaces' }, 'test')).toMatchObject({
      ok: false,
      reason: 'packageSelection',
    })
    expect(walkB2Scripts({ test: 'npm install' }, 'test')).toMatchObject({
      ok: false,
      reason: 'managerUse',
    })
    expect(walkB2Scripts({ test: 'npm run lint -- --fix' }, 'test')).toMatchObject({
      ok: false,
      reason: 'managerUse',
    })
    expect(walkB2Scripts({}, 'test')).toMatchObject({ ok: false, reason: 'missingScript' })
    expect(walkB2Scripts({ test: 'a; b' }, 'test')).toMatchObject({
      ok: false,
      reason: 'scriptSyntax',
    })
  })

  it('leaves the check programs alone', () => {
    const walked = walkB2Scripts({ test: 'vitest --dir src && npx tsc --noEmit' }, 'test')
    expect(walked.ok).toBe(true)
  })
})

describe('B2 named files', () => {
  it('pins the files words name, through flags and assignments', () => {
    const parsed = parseB2ScriptText(
      'NODE_OPTIONS=--require ./hooks/pre.js vitest --config vitest.config.ts && ./scripts/check.js',
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const pinned = pinB2Files(
      collectB2Candidates(parsed.commands),
      answers({
        'hooks/pre.js': 'preload',
        'vitest.config.ts': 'config',
        'scripts/check.js': 'check',
      }),
    )
    expect(pinned.map((file) => file.path)).toEqual([
      'hooks/pre.js',
      'vitest.config.ts',
      'scripts/check.js',
    ])
  })

  it('cannot hide a path in an attached flag value', () => {
    expect(b2WordCandidates('-csecret.txt')).toContain('secret.txt')
    const parsed = parseB2ScriptText('prog -csecret.txt')
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const pinned = pinB2Files(collectB2Candidates(parsed.commands), answers({ 'secret.txt': 'x' }))
    expect(pinned.map((file) => file.path)).toEqual(['secret.txt'])
  })

  it('drops absolute and escaping paths before the answers', () => {
    const seen: string[] = []
    pinB2Files(['/etc/hostname', '../../etc/hostname', 'a/../../b', 'ok.txt'], {
      statEntry: (relative) => {
        seen.push(relative)
        return 'other'
      },
      readEntryBytes: () => undefined,
      readEntryLink: () => undefined,
    })
    expect(seen).toEqual(['ok.txt'])
  })
})

describe('B2 closure assembly', () => {
  it('collects scripts, fields, configs and files', () => {
    const command = parseB2Command('npm test')
    expect(command.ok).toBe(true)
    if (!command.ok) return
    const packageJson = parseB2PackageJson(
      JSON.stringify({
        scripts: { test: 'vitest --config vitest.config.ts' },
        packageManager: 'npm@11.0.0',
        version: '1.2.3',
      }),
    )
    expect(packageJson.ok).toBe(true)
    if (!packageJson.ok) return
    const collected = collectB2Closure(
      command.command,
      packageJson.packageJson,
      {
        yarnLock: false,
        yarnrc: false,
        yarnrcYml: false,
        pnpmfile: false,
      },
      [
        {
          source: '.npmrc',
          keys: ['save-exact'],
          bytes: new TextEncoder().encode('save-exact=true\n'),
        },
      ],
      answers({ 'vitest.config.ts': 'config' }),
    )
    expect(collected.ok).toBe(true)
    if (!collected.ok) return
    expect(collected.closure.scripts.map((script) => script.name)).toEqual(['test'])
    expect(collected.closure.fields).toEqual({ packageManager: '"npm@11.0.0"' })
    expect(collected.closure.files.map((file) => file.path)).toEqual(['vitest.config.ts'])
  })

  it('refuses yarn, pnpmfiles, bad keys and bad shapes', () => {
    const command = parseB2Command('npm test')
    if (!command.ok) throw new Error('the drill command must parse')
    const packageJson = parseB2PackageJson(JSON.stringify({ scripts: { test: 'vitest' } }))
    if (!packageJson.ok) throw new Error('the drill manifest must parse')
    const clean = {
      yarnLock: false,
      yarnrc: false,
      yarnrcYml: false,
      pnpmfile: false,
    }
    expect(
      collectB2Closure(
        command.command,
        packageJson.packageJson,
        { ...clean, yarnLock: true },
        [],
        answers({}),
      ),
    ).toMatchObject({ ok: false, reason: 'managerFiles' })
    expect(
      collectB2Closure(
        command.command,
        packageJson.packageJson,
        { ...clean, pnpmfile: true },
        [],
        answers({}),
      ),
    ).toMatchObject({ ok: false, reason: 'managerFiles' })
    expect(
      collectB2Closure(
        command.command,
        packageJson.packageJson,
        clean,
        [{ source: '.npmrc', keys: ['node-options'], bytes: new Uint8Array() }],
        answers({}),
      ),
    ).toMatchObject({ ok: false, reason: 'configKeys', at: '.npmrc' })
    expect(parseB2PackageJson('{oops')).toMatchObject({ ok: false, reason: 'invalidJson' })
    expect(parseB2PackageJson('[]')).toMatchObject({ ok: false, reason: 'notObject' })
    expect(parseB2PackageJson('{"scripts":{"test":7}}')).toMatchObject({
      ok: false,
      reason: 'scriptsShape',
    })
  })

  it('digests the closure and the invocation apart', () => {
    const left = parseB2Command('npm test -- src/a.test.ts')
    const right = parseB2Command('npm test -- src/b.test.ts')
    if (!left.ok || !right.ok) throw new Error('the drill commands must parse')
    expect(digestB2Invocation(left.command)).toMatch(/^[0-9a-f]{64}$/u)
    expect(digestB2Invocation(left.command)).not.toBe(digestB2Invocation(right.command))
    const packageJson = parseB2PackageJson(JSON.stringify({ scripts: { test: 'vitest' } }))
    if (!packageJson.ok) throw new Error('the drill manifest must parse')
    const clean = { yarnLock: false, yarnrc: false, yarnrcYml: false, pnpmfile: false }
    const one = collectB2Closure(left.command, packageJson.packageJson, clean, [], answers({}))
    const two = collectB2Closure(right.command, packageJson.packageJson, clean, [], answers({}))
    if (!one.ok || !two.ok) throw new Error('the drill closures must collect')
    expect(digestB2Closure(one.closure)).toBe(digestB2Closure(two.closure))
  })
})
