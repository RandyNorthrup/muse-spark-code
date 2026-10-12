import { spawn, execFileSync, type ChildProcess, type StdioOptions } from 'node:child_process'
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  linkSync,
} from 'node:fs'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fileIdentityKey, statIdentity } from '../../src/core/fs/fileIdentity'
import { InspectRunner, type InspectExecOptions } from '../../src/core/judge/fast/inspectExec'
import { JUDGE_FAST_B1_REFUSED_EXIT } from '../../src/shared/constants'
import { parseInspectCommand } from '../../src/core/judge/fast/inspectGrammar'
import { inspectStart } from './helpers/inspectStart'
import { inspectPathSpellings, inspectProtectedPaths } from './helpers/inspectPaths'

interface Receipt {
  stdout: Buffer
  stderr: string
  code: number | null
}
function native(
  file: string,
  args: string[],
  cwd: string,
  ready?: () => void,
  stdio?: StdioOptions,
): Promise<Receipt> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: {}, stdio: stdio ?? ['ignore', 'pipe', 'pipe'] })
    const output: Buffer[] = [],
      errors: Buffer[] = []
    let hasReady = false
    child.stdout?.on('data', (chunk: Buffer) => {
      output.push(chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      errors.push(chunk)
      if (hasReady || !chunk.toString().includes('"confined":true')) {
        return
      }

      hasReady = true
      ready?.()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      resolve({ stdout: Buffer.concat(output), stderr: Buffer.concat(errors).toString(), code })
    })
  })
}

// Replays exact helper bytes for runner-parsing tests (the session self-test
// cannot run in this sandbox): probe and self-test answers, then a confined
// line followed by the refusal, exit 125.
const launched = (child: ChildProcess) =>
  Promise.resolve({
    child,
    pid: () => Promise.resolve(child.pid),
    outcome: () => Promise.resolve(undefined),
    stop: () => {
      child.kill('SIGKILL')
      return Promise.resolve()
    },
  })
const replay = (stdout: string, stderr: string, code: number) =>
  spawn(
    process.execPath,
    [
      '-e',
      `process.stdout.write(${JSON.stringify(stdout)}, () => { process.stderr.write(${JSON.stringify(stderr)}, () => process.exit(${String(code)})); });`,
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], shell: false },
  )
const replayStart: InspectExecOptions['start'] = (_file, args) => {
  const program = args[0] === 'probe' ? 'probe' : (args[5] ?? '')
  if (program === 'probe') return launched(replay('{"abi":7,"confined":true}\n', '', 0))
  if (program === 'cat')
    return launched(replay('B1_ALLOWED_CANARY', '{"confined":true,"abi":7,"excluded":0}\n', 0))
  if (program === 'grep')
    return launched(replay('B1_ALLOWED_CANARY\n', '{"confined":true,"abi":7,"excluded":3}\n', 0))
  const refused = program === 'stat' ? 'operand' : 'exec'
  return launched(
    replay(
      '',
      `{"confined":true,"abi":7,"excluded":0}\n{"refused":"${refused}"}\n`,
      JUDGE_FAST_B1_REFUSED_EXIT,
    ),
  )
}

if (process.platform === 'linux') {
  describe('B1 Linux kernel boundary', () => {
    let scratch = '',
      binary = ''
    const variants = new Map<string, string>()
    beforeAll(async () => {
      scratch = await mkdtemp(path.join(os.tmpdir(), 'b1-native-'))
      execFileSync(process.execPath, ['scripts/build-confine.mjs'], {
        env: { PATH: '/usr/bin:/bin' },
      })
      binary = path.resolve('temp/confine/muse-confine')
      for (const name of [
        'Race',
        'StatRace',
        'StatMask',
        'StatNoExec',
        'StatChecks',
        'ExecFail',
        'Guards',
        'Device',
        'Budget',
        'Trust',
        'Time',
        'Depth',
        'Abi',
        'Root',
        'Paths',
      ]) {
        const variant = path.join(scratch, name)
        execFileSync(
          '/usr/bin/cc',
          [
            '-std=c11',
            '-O2',
            '-Wall',
            '-Wextra',
            '-Werror',
            '-Wconversion',
            '-Wshadow',
            '-I',
            'temp/confine',
            `test/unit/helpers/inspect${name}.c`,
            '-o',
            variant,
          ],
          { env: { PATH: '/usr/bin:/bin' } },
        )
        variants.set(name, variant)
      }
    })
    afterAll(async () => {
      if (scratch) await rm(scratch, { recursive: true, force: true })
    })
    const variant = (name: string) => {
      const file = variants.get(name)
      if (file === undefined) throw new Error('Missing compiled fixture')
      return file
    }
    async function fixture() {
      const root = await mkdtemp(path.join(scratch, 'case-'))
      const workspace = path.join(root, 'workspace'),
        home = path.join(root, 'home')
      await mkdir(workspace)
      await mkdir(home, { mode: 0o700 })
      const allowed = path.join(workspace, 'allowed.txt'),
        outside = path.join(root, 'outside.txt')
      writeFileSync(allowed, 'ALLOWED_CANARY\n')
      writeFileSync(outside, 'FORBIDDEN_CANARY\n')
      const identity = fileIdentityKey(await statIdentity(workspace))
      if (identity === undefined) throw new Error('Missing workspace identity')
      const args = (program: string, operands: string[], tool: string[], isRecursive = false) => [
        'run',
        workspace,
        identity,
        home,
        isRecursive ? 'recursive' : 'single',
        program,
        ...operands,
        '--',
        ...tool,
      ]
      return {
        root,
        workspace,
        binding: { root: workspace, identity },
        home,
        allowed,
        outside,
        args,
      }
    }

    it('captures ABI, post-walk inode confinement, process/network/write refusal', async () => {
      const h = await fixture()
      const result = await native(binary, ['probe'], h.root)
      expect(result.code).toBe(0)
      expect(result.stdout.toString()).toMatch(/^\{"abi":[3-8],"confined":true\}\n$/u)
    })
    it('refuses root before creating any self-test files', async () => {
      const h = await fixture()
      const before = await readdir(h.root)
      const result = await native(variant('Root'), ['probe'], h.root)
      expect(result.code).toBe(125)
      expect(result.stderr).toContain('root')
      expect(await readdir(h.root)).toEqual(before)
    })
    it.each([
      ['cat', ['allowed.txt']],
      ['ls', ['-l', '.']],
      ['head', ['-n', '1', 'allowed.txt']],
      ['tail', ['-c', '2', 'allowed.txt']],
      ['wc', ['-l', 'allowed.txt']],
      ['stat', ['allowed.txt']],
      ['du', ['-s', '.']],
      ['grep', ['-e', 'ALLOWED', 'allowed.txt']],
      ['find', ['.', '-print']],
    ])('runs verified %s or refuses its unsupported thread requirement', async (program, tool) => {
      const h = await fixture()
      const isRecursive = program === 'find' || program === 'du'
      const operand = tool.at(-1) === 'allowed.txt' ? 'allowed.txt' : '.'
      const result = await native(binary, h.args(program, [operand], tool, isRecursive), h.root)
      if (program === 'du' && result.code === null) {
        expect(result.stderr).toContain('failed to spawn thread')
        expect(result.stderr).toContain('PermissionDenied')
        expect(result.stdout.length).toBe(0)
        return
      }
      expect(result.code, `${program}: ${result.stderr}`).toBe(0)
      expect(result.stderr).toMatch(/^\{"confined":true,/u)
      if (program === 'ls')
        expect(result.stdout.toString()).toContain(String(statSync(h.allowed).uid))
    })
    it('reports stat without the system stat binary: mode, owners, links and times match fs.statSync', async () => {
      // The NoExec variant fails every execve, so exit 0 proves no binary ran.
      const h = await fixture()
      for (const [operand, kind] of [
        ['allowed.txt', 'regular file'],
        ['.', 'directory'],
      ] as const) {
        const result = await native(
          variant('StatNoExec'),
          h.args('stat', [operand], [operand]),
          h.root,
        )
        expect(result.code, operand).toBe(0)
        expect(result.stderr).toMatch(/^\{"confined":true,/u)
        const expected = statSync(path.join(h.workspace, operand))
        const stdout = result.stdout.toString()
        expect(stdout).toContain(`File: ${operand}\n`)
        expect(stdout).toContain(`Size: ${String(expected.size)} `)
        expect(stdout).toContain(`Inode: ${String(expected.ino)} `)
        expect(stdout).toContain(`Device: ${expected.dev.toString(16)}h/${String(expected.dev)}d `)
        expect(stdout).toContain(kind)
        expect(stdout).toContain(`Links: ${String(expected.nlink)}\n`)
        const octal = (expected.mode & 0o7777).toString(8).padStart(4, '0')
        expect(stdout).toContain(`Access: (${octal}/`)
        expect(stdout).toContain(`Uid: (${String(expected.uid).padStart(5)}/ UNKNOWN)`)
        expect(stdout).toContain(`Gid: (${String(expected.gid).padStart(5)}/ UNKNOWN)`)
        // Times print in UTC with nanoseconds; fs.statSync resolves
        // milliseconds, so the comparison tolerance is milliseconds.
        const instants: readonly (readonly [string, number])[] = [
          ['Access', expected.atimeMs],
          ['Modify', expected.mtimeMs],
          ['Change', expected.ctimeMs],
        ]
        for (const [label, ms] of instants) {
          const line = stdout
            .split('\n')
            .find((entry) => entry.startsWith(`${label}: `) && /\d{4}-/u.test(entry))
          const match =
            /^(\w+): (\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})\.(\d{9}) \+0000$/u.exec(
              line ?? '',
            )
          expect(match, `${operand} ${label}`).not.toBeNull()
          if (match === null) throw new Error('Missing reported time')
          const reported =
            Date.UTC(
              Number(match[2]),
              Number(match[3]) - 1,
              Number(match[4]),
              Number(match[5]),
              Number(match[6]),
              Number(match[7]),
            ) +
            Number(match[8]) / 1e6
          expect(Math.abs(reported - ms), `${operand} ${label}`).toBeLessThan(5)
        }
        if (expected.birthtimeMs === 0) expect(stdout).toContain('Birth: -\n')
        else {
          const line = stdout.split('\n').find((entry) => entry.startsWith('Birth:'))
          expect(line, `${operand} Birth`).toMatch(/^Birth: \d{4}-/u)
        }
      }
    })
    it('stat prints a dash for every field the filesystem withholds, never zero or 1970', async () => {
      const h = await fixture()
      const result = await native(
        variant('StatMask'),
        h.args('stat', ['allowed.txt'], ['allowed.txt']),
        h.root,
      )
      expect(result.code, result.stderr).toBe(0)
      const stdout = result.stdout.toString()
      expect(stdout).toContain('Size: -  Blocks: - ')
      expect(stdout).toContain('Uid: (-/ UNKNOWN)  Gid: (-/ UNKNOWN)')
      expect(stdout).toContain('Access: -\n')
      expect(stdout).toContain('Modify: -\n')
      expect(stdout).toContain('Change: -\n')
      expect(stdout).toContain('Birth: -\n')
      expect(stdout).not.toContain('1970')
      expect(stdout).not.toContain('Size: 0')
      // The supplied fields still print.
      const expected = statSync(h.allowed)
      expect(stdout).toContain(`Inode: ${String(expected.ino)} `)
      expect(stdout).toContain(`Device: ${expected.dev.toString(16)}h/${String(expected.dev)}d `)
    })
    it('a refusal after the walk leaves the refusal as the last stderr line', async () => {
      // The ExecFail variant fails wc's execve. Where /usr/bin/wc verifies,
      // that is a confined line plus {"refused":"exec"}; on this uutils rig
      // no system file verifies (every one is nobody-owned), so the refusal
      // stands alone. Either way the last line is the refusal the runner reads.
      const h = await fixture()
      const result = await native(
        variant('ExecFail'),
        h.args('wc', ['allowed.txt'], ['-l', 'allowed.txt']),
        h.root,
      )
      expect(result.code).toBe(125)
      expect(result.stdout.length).toBe(0)
      const lines = result.stderr.split('\n').filter((line) => line.length > 0)
      expect(lines.at(-1)).toMatch(/^\{"refused":"[a-zA-Z]+"\}$/u)
      if (lines.length === 2) {
        expect(lines[0]).toMatch(/^\{"confined":true,/u)
        expect(lines.at(-1)).toBe('{"refused":"exec"}')
      } else expect(lines).toHaveLength(1)
    })
    it('the runner reports the refusal reason, not confinement, after the confined line', async () => {
      // Replays the exact bytes the helper emits (pinned above against the
      // real helper): probe and self-test answers, then a confined line
      // followed by the refusal, exit 125. The session self-test cannot run
      // in this sandbox, so the runner logic is proved here and the helper
      // bytes against the real binary above.
      const h = await fixture()
      const runner = new InspectRunner({
        helper: binary,
        storage: path.join(h.root, 'storage'),
        start: replayStart,
      })
      try {
        expect(await runner.run('wc -l allowed.txt', h.binding)).toEqual({
          kind: 'refused',
          reason: 'exec',
        })
        expect(await runner.run('stat link', h.binding)).toEqual({
          kind: 'refused',
          reason: 'operand',
        })
      } finally {
        await runner.dispose()
      }
    })
    it('stat refuses a recursive run and tool arguments that do not mirror the operands', async () => {
      const h = await fixture()
      const recursive = await native(
        binary,
        h.args('stat', ['allowed.txt'], ['allowed.txt'], true),
        h.root,
      )
      expect(recursive.code).toBe(125)
      expect(recursive.stdout.length).toBe(0)
      expect(recursive.stderr).toContain('request')
      const count = await native(
        binary,
        h.args('stat', ['allowed.txt'], ['allowed.txt', 'allowed.txt']),
        h.root,
      )
      expect(count.code).toBe(125)
      expect(count.stdout.length).toBe(0)
      expect(count.stderr).toContain('request')
      const spelling = await native(
        binary,
        h.args('stat', ['allowed.txt', '.'], ['allowed.txt', 'allowed.txt']),
        h.root,
      )
      expect(spelling.code).toBe(125)
      expect(spelling.stdout.length).toBe(0)
      expect(spelling.stderr).toContain('request')
    })
    it('stat refuses symlinked and hard-linked operands after the walk', async () => {
      const h = await fixture()
      symlinkSync(h.outside, path.join(h.workspace, 'link'))
      linkSync(h.outside, path.join(h.workspace, 'hardlink'))
      for (const operand of ['link', 'hardlink']) {
        const result = await native(binary, h.args('stat', [operand], [operand]), h.root)
        expect(result.code, operand).toBe(125)
        expect(result.stdout.length).toBe(0)
        expect(result.stderr).toContain('operand')
      }
    })
    it('the post-walk stat checks refuse hostile shapes and accept files and folders', async () => {
      const h = await fixture()
      const result = await native(variant('StatChecks'), [], h.root)
      expect(result.code, result.stderr).toBe(0)
      const stdout = result.stdout.toString()
      for (const line of [
        'ok regular',
        'ok directory',
        'ok symlink-refused',
        'ok foreign-device-refused',
        'ok hardlink-refused',
        'ok fifo-refused',
      ])
        expect(stdout, line).toContain(`${line}\n`)
      expect(stdout).not.toContain('FAIL')
    })
    it('stat -- name answers: the grammar drops the separator the helper would refuse', async () => {
      // Builds the helper argv exactly as InspectRunner.execute does, so the
      // grammar's tool arguments and the helper's mirror check must agree.
      const h = await fixture()
      const parsed = parseInspectCommand('stat -- allowed.txt')
      expect(parsed).toMatchObject({
        program: 'stat',
        args: ['allowed.txt'],
        operands: ['allowed.txt'],
      })
      if (parsed === undefined) throw new Error('Missing parsed command')
      const result = await native(
        binary,
        [
          'run',
          h.workspace,
          h.binding.identity,
          h.home,
          'single',
          parsed.program,
          ...parsed.operands,
          '--',
          ...parsed.args,
        ],
        h.root,
      )
      expect(result.code, result.stderr).toBe(0)
      expect(result.stdout.toString()).toContain('File: allowed.txt\n')
    })
    it('B1-3/4/5/6/7 excludes protected/private descendants, links, devices, hard links and foreign device ids', async () => {
      const h = await fixture()
      for (const name of [
        '.git/config',
        'pkg/.git/config',
        '.claude/settings.json',
        '.env',
        'config/.env.production',
        'certs/dev.pem',
        'AGENTS.md',
        'foreign.txt',
      ]) {
        const file = path.join(h.workspace, name)
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, 'FORBIDDEN_CANARY\n')
      }
      symlinkSync(h.outside, path.join(h.workspace, 'link'))
      symlinkSync(path.dirname(h.outside), path.join(h.workspace, 'linkdir'))
      linkSync(h.outside, path.join(h.workspace, 'hardlink'))
      execFileSync('/usr/bin/mkfifo', [path.join(h.workspace, 'pipe')], { env: {} })
      const result = await native(
        variant('Device'),
        h.args('grep', ['.'], ['-r', '-e', 'CANARY', '.'], true),
        h.root,
      )
      expect(result.stdout.toString()).toContain('ALLOWED_CANARY')
      expect(result.stdout.toString()).not.toContain('FORBIDDEN_CANARY')
      expect(result.stderr).toContain('"excluded":')
      for (const name of ['hardlink', 'linkdir', 'link', 'foreign.txt', '.git/config']) {
        const denied = await native(variant('Device'), h.args('cat', [name], [name]), h.root)
        expect(denied.code).toBe(125)
        expect(denied.stdout.length).toBe(0)
      }
    })
    it('canonicalizes seeded spellings of every protected/private path and refuses noncanonical helper operands', async () => {
      const h = await fixture()
      const canonicalPaths = [
        'allowed.txt',
        ...inspectProtectedPaths.flatMap((name) => [
          name,
          name.toUpperCase(),
          `pkg/${name}/probe.txt`,
          `pkg/${name.toUpperCase()}/probe.txt`,
        ]),
      ]
      const spellings = canonicalPaths.flatMap((canonical) => inspectPathSpellings(canonical))
      const result = await native(variant('Paths'), spellings, h.root)
      expect(result.code).toBe(0)
      expect(result.stdout.toString()).toBe(
        canonicalPaths
          .flatMap((canonical, index) =>
            inspectPathSpellings(canonical).map(
              (spelling) =>
                `${canonical}\t${String(index === 0 && spelling === canonical ? 0 : 1)}\t${String(index === 0 ? 0 : 1)}\n`,
            ),
          )
          .join(''),
      )
      for (const operand of [
        './allowed.txt',
        'allowed.txt/.',
        'x/../allowed.txt',
        'pkg//file',
        'pkg/',
        '-n',
        'C:outside',
        String.raw`pkg\.github\workflows\probe.txt`,
      ]) {
        const denied = await native(binary, h.args('cat', [operand], [operand]), h.root)
        expect(denied.code, operand).toBe(125)
        expect(denied.stdout.length).toBe(0)
        expect(denied.stderr).toContain('privateOperand')
      }
    })
    it('withholds every protected/private descendant through canonical recursive runner operands', async () => {
      const h = await fixture()
      mkdirSync(path.join(h.workspace, 'pkg'))
      writeFileSync(path.join(h.workspace, 'pkg/allowed.txt'), 'ALLOWED_CANARY\n')
      for (const name of inspectProtectedPaths) {
        const file = path.join(h.workspace, 'pkg', name, 'probe.txt')
        mkdirSync(path.dirname(file), { recursive: true })
        writeFileSync(file, 'FORBIDDEN_CANARY\n')
      }
      mkdirSync(path.join(h.workspace, 'pkg/.github/workflows-extra'))
      writeFileSync(
        path.join(h.workspace, 'pkg/.github/workflows-extra/probe.txt'),
        'ALLOWED_CANARY\n',
      )
      const runner = new InspectRunner({
        helper: binary,
        storage: path.join(h.root, 'storage'),
        start: inspectStart,
      })
      try {
        for (const operand of ['.', './pkg/.', 'pkg/./.github/.']) {
          const result = await runner.run(`grep -r -e CANARY ${operand}`, h.binding)
          expect(result.kind, operand).toBe('output')
          if (result.kind !== 'output') throw new Error('Missing confined result')
          expect(result.stdout, operand).not.toContain('FORBIDDEN_CANARY')
          expect(result.excluded, operand).toBeGreaterThan(0)
          expect(result.stdout, operand).toContain('ALLOWED_CANARY')
        }
        expect(await runner.run('cat pkg/.github/./workflows/probe.txt', h.binding)).toEqual({
          kind: 'refused',
          reason: 'grammar',
        })
      } finally {
        await runner.dispose()
      }
    })
    it('B1-1/2 refuses ancestor and leaf swaps both before the open and after grants', async () => {
      for (const isAncestor of [true, false]) {
        for (const isAfter of [false, true]) {
          const h = await fixture()
          mkdirSync(path.join(h.workspace, 'src'))
          writeFileSync(path.join(h.workspace, 'src/a.txt'), 'ALLOWED_CANARY')
          mkdirSync(path.join(h.root, 'foreign'))
          writeFileSync(path.join(h.root, 'foreign/a.txt'), 'FORBIDDEN_CANARY')
          const target = path.join(h.workspace, isAncestor ? 'src' : 'src/a.txt')
          const swap = () => {
            renameSync(target, `${target}.old`)
            symlinkSync(isAncestor ? path.join(h.root, 'foreign') : h.outside, target)
          }
          if (!isAfter) swap()
          const result = await native(
            isAfter ? variant('Race') : binary,
            h.args('cat', ['src/a.txt'], ['src/a.txt']),
            h.root,
            isAfter ? swap : undefined,
          )
          expect(result.stdout.length).toBe(0)
          expect(result.code).not.toBe(0)
        }
      }
    })
    it('stat reports the walked file when an ancestor is swapped for a link mid-report', async () => {
      const h = await fixture()
      mkdirSync(path.join(h.workspace, 'src'))
      writeFileSync(path.join(h.workspace, 'src/a.txt'), 'ALLOWED_CANARY\n')
      mkdirSync(path.join(h.root, 'foreign'))
      writeFileSync(path.join(h.root, 'foreign/a.txt'), 'FORBIDDEN_CANARY_IS_LONGER\n')
      const original = statSync(path.join(h.workspace, 'src/a.txt'))
      const outside = statSync(path.join(h.root, 'foreign/a.txt'))
      expect(outside.size).not.toBe(original.size)
      const pending = native(
        variant('StatRace'),
        h.args('stat', ['src/a.txt'], ['src/a.txt']),
        h.root,
      )
      // The report's statx waits 200 ms; swap inside that window, after the walk.
      await new Promise((resolve) => setTimeout(resolve, 50))
      renameSync(path.join(h.workspace, 'src'), path.join(h.workspace, 'src.old'))
      symlinkSync(path.join(h.root, 'foreign'), path.join(h.workspace, 'src'))
      const result = await pending
      // A swap that lands before the walk is a refusal; one after it still
      // reports the walked file. It never reports the outside file.
      expect(result.stdout.toString()).not.toContain(`Size: ${String(outside.size)} `)
      if (result.code === 0) {
        expect(result.stderr).toMatch(/^\{"confined":true,/u)
        expect(result.stdout.toString()).toContain(`Size: ${String(original.size)} `)
        expect(result.stdout.toString()).toContain(`Inode: ${String(original.ino)} `)
      } else {
        expect(result.code).toBe(125)
        expect(result.stdout.length).toBe(0)
      }
    })
    it('B1-12 refuses inserted, renamed and replacement inodes after a recursive walk', async () => {
      const h = await fixture()
      mkdirSync(path.join(h.workspace, '.git'))
      writeFileSync(path.join(h.workspace, '.git/config'), 'FORBIDDEN_CANARY')
      const result = await native(
        variant('Race'),
        h.args('grep', ['.'], ['-r', '-e', 'CANARY', '.'], true),
        h.root,
        () => {
          linkSync(h.outside, path.join(h.workspace, 'inserted'))
          renameSync(path.join(h.workspace, '.git/config'), path.join(h.workspace, 'renamed'))
          unlinkSync(h.allowed)
          linkSync(h.outside, h.allowed)
        },
      )
      expect(result.stdout.length).toBe(0)
    })
    it('B1-13 exposes Linux names/metadata without protected contents', async () => {
      const h = await fixture()
      mkdirSync(path.join(h.workspace, '.git'))
      writeFileSync(path.join(h.workspace, '.git/config'), 'FORBIDDEN_CANARY')
      const result = await native(binary, h.args('find', ['.'], ['.', '-print'], true), h.root)
      expect(result.stdout.toString()).toContain('.git/config')
      expect(result.stdout.toString()).not.toContain('FORBIDDEN_CANARY')
    })
    it('B1-14 denies passwd and unused libraries but documents exact libc/cache exceptions', async () => {
      const libdir = process.arch === 'x64' ? '/lib/x86_64-linux-gnu' : '/lib/aarch64-linux-gnu'
      for (const [target, isAllowed] of [
        ['/etc/passwd', false],
        [path.join(libdir, 'libz.so.1'), false],
        [path.join(libdir, 'libc.so.6'), true],
        ['/etc/ld.so.cache', true],
      ]) {
        if (typeof target !== 'string' || typeof isAllowed !== 'boolean')
          throw new Error('Invalid case')
        const h = await fixture()
        const result = await native(
          variant('Race'),
          h.args('cat', ['allowed.txt'], ['allowed.txt']),
          h.root,
          () => {
            unlinkSync(h.allowed)
            symlinkSync(target, h.allowed)
          },
        )
        if (isAllowed) expect(result.stdout.equals(readFileSync(target))).toBe(true)
        else expect(result.stdout.length).toBe(0)
      }
    })
    it('B1-10 closes inherited descriptors and refuses writes, network, keys, ptrace, io_uring and process creation', async () => {
      const h = await fixture()
      const descriptor = openSync(h.outside, 'r')
      const stdio: StdioOptions = Array.from({ length: 101 }, () => 'ignore')
      stdio[0] = 'ignore'
      stdio[1] = 'pipe'
      stdio[2] = 'pipe'
      stdio[100] = descriptor
      try {
        const result = await native(
          variant('Guards'),
          h.args('cat', ['allowed.txt'], ['allowed.txt']),
          h.root,
          undefined,
          stdio,
        )
        expect(result.code).toBe(0)
        expect(result.stdout.toString()).toBe('ALL_GUARDS_REFUSED\n')
      } finally {
        closeSync(descriptor)
      }
      expect(readFileSync(h.allowed, 'utf8')).toBe('ALLOWED_CANARY\n')
    })
    it('fails closed on traversal budgets, identity mismatch and user-writable executables or ancestry', async () => {
      const h = await fixture()
      writeFileSync(path.join(h.workspace, 'second'), 'ordinary')
      const budget = await native(
        variant('Budget'),
        h.args('grep', ['.'], ['-r', '-e', 'CANARY', '.'], true),
        h.root,
      )
      expect(budget.code).toBe(125)
      expect(budget.stderr).toContain('walkBudget')
      for (const name of ['Time', 'Depth']) {
        const result = await native(
          variant(name),
          h.args('grep', ['.'], ['-r', '-e', 'CANARY', '.'], true),
          h.root,
        )
        expect(result.code).toBe(125)
        expect(result.stderr).toContain('walkBudget')
      }
      const oldAbiRoot = await mkdtemp(path.join(h.root, 'abi-'))
      const oldAbi = await native(variant('Abi'), ['probe'], oldAbiRoot)
      expect(oldAbi.code).toBe(125)
      expect(oldAbi.stderr).toContain('landlockAbi')
      const args = h.args('cat', ['allowed.txt'], ['allowed.txt'])
      args[2] = '0:0'
      const identity = await native(binary, args, h.root)
      expect(identity.stderr).toContain('workspaceIdentity')
      writeFileSync(path.join(h.root, 'cat'), readFileSync('/bin/cat'), { mode: 0o755 })
      symlinkSync(path.join(h.root, 'cat'), path.join(h.root, 'cat-link'))
      for (const file of ['cat', 'cat-link']) {
        const trust = await native(variant('Trust'), [path.join(h.root, file)], h.root)
        expect(trust.code).toBe(125)
      }
      for (const fault of ['uid', 'group', 'other', 'acl', 'identity']) {
        const trust = await native(variant('Trust'), ['/bin/cat', fault], h.root)
        expect(trust.code, fault).toBe(125)
        expect(trust.stderr).toContain('systemFile')
      }
      const rg = await native(binary, h.args('rg', ['.'], ['x', '.']), h.root)
      expect(rg.code).toBe(125)
    })
    it('B1 root binding refuses a workspace retargeted after the session binds it', async () => {
      const h = await fixture()
      const runner = new InspectRunner({
        helper: binary,
        storage: path.join(h.root, 'storage'),
        start: inspectStart,
      })
      try {
        const first = await runner.run('cat allowed.txt', h.binding)
        expect(first.kind).toBe('output')
        const foreign = path.join(h.root, 'foreign-project')
        mkdirSync(foreign)
        writeFileSync(path.join(foreign, 'allowed.txt'), 'FORBIDDEN_CANARY')
        renameSync(h.workspace, `${h.workspace}.old`)
        symlinkSync(foreign, h.workspace)
        const result = await runner.run('cat allowed.txt', h.binding)
        expect(result.kind).toBe('refused')
      } finally {
        await runner.dispose()
      }
    })
    it('runs session self-tests once, preserves command failures and withholds secrets before delivery', async () => {
      const h = await fixture()
      const runner = new InspectRunner({
        helper: binary,
        storage: path.join(h.root, 'storage'),
        start: inspectStart,
      })
      try {
        const [a, b] = await Promise.all([
          runner.run('cat allowed.txt', h.binding),
          runner.run('wc -l allowed.txt', h.binding),
        ])
        expect(a).toMatchObject({ kind: 'output', stdout: 'ALLOWED_CANARY\n', exitCode: 0 })
        expect(b).toMatchObject({ kind: 'output', exitCode: 0 })
        writeFileSync(h.allowed, 'password = "synthetic-sensitive-canary"\n')
        expect(await runner.run('cat allowed.txt', h.binding)).toEqual({
          kind: 'refused',
          reason: 'secret',
        })
        expect(await runner.run('cat absent.txt', h.binding)).toEqual({
          kind: 'refused',
          reason: 'operand',
        })
      } finally {
        await runner.dispose()
      }
    })
  })
} else {
  it('keeps uncertified platforms off without spawning', async () => {
    const runner = new InspectRunner({
      helper: '',
      storage: '',
      start: () => {
        throw new Error('Must not spawn')
      },
    })
    expect(await runner.run('cat x', { root: '.', identity: '0:0' })).toEqual({
      kind: 'refused',
      reason: 'platform',
    })
    await runner.dispose()
  })
}
