import { spawn, execFileSync, type StdioOptions } from 'node:child_process'
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
import { InspectRunner } from '../../src/core/judge/fast/inspectExec'
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

switch (process.platform) {
  case 'linux': {
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
      ])(
        'runs verified %s or refuses its unsupported thread requirement',
        async (program, tool) => {
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
        },
      )
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
    break
  }
  case 'darwin': {
    describe('B1 macOS Seatbelt boundary', () => {
      // The repo build shells /usr/bin/cc with a scrubbed environment and the
      // live drills need sandbox-exec to apply a profile. Both are attempted
      // here so hosted macOS CI always builds fresh and runs everything; a
      // failed attempt skips its tests visibly instead of failing the suite.
      // (An agent sandbox denies sandbox_apply, and a rig with a broken
      // xcode-select denies the compiler shim: both skip here, both are in
      // docs/certification/paritymac.md with manual readings.)
      const macPrereqs = ((): { binary: string | null; variant: string | null; live: boolean } => {
        const none = { binary: null, variant: null, live: false }
        try {
          execFileSync(process.execPath, ['scripts/build-confine.mjs'], {
            env: { PATH: '/usr/bin:/bin' },
            stdio: 'pipe',
          })
        } catch {
          return none
        }
        const built: { binary: string | null; variant: string | null; live: boolean } = {
          binary: path.resolve('temp/confine/muse-confine'),
          variant: null,
          live: false,
        }
        try {
          built.variant = path.resolve('temp/confine/mac-paths')
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
              'test/unit/helpers/inspectMacPaths.c',
              '-o',
              built.variant,
            ],
            { env: { PATH: '/usr/bin:/bin' }, stdio: 'pipe' },
          )
        } catch {
          return { binary: built.binary, variant: null, live: false }
        }
        try {
          execFileSync(
            '/usr/bin/sandbox-exec',
            ['-p', '(version 1)(allow default)', '/usr/bin/true'],
            { env: { PATH: '/usr/bin:/bin' }, stdio: 'pipe' },
          )
          built.live = true
        } catch {
          built.live = false
        }
        return built
      })()
      const binary = macPrereqs.binary
      const hasBinary = binary !== null
      let scratch = ''
      beforeAll(async () => {
        scratch = await mkdtemp(path.join(os.tmpdir(), 'b1-mac-'))
      })
      afterAll(async () => {
        if (scratch) await rm(scratch, { recursive: true, force: true })
      })
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

      // These refusals land before any profile is applied, so they hold with
      // and without a live sandbox.
      describe.runIf(hasBinary)('pre-confinement refusals', () => {
        it('refuses an identity mismatch before confinement', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          const args = h.args('cat', ['allowed.txt'], ['allowed.txt'])
          args[2] = '0:0'
          const result = await native(binary, args, h.root)
          expect(result.code).toBe(125)
          expect(result.stderr).toContain('workspaceIdentity')
          expect(result.stdout.length).toBe(0)
        })
        it('refuses unknown programs before confinement', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          const result = await native(binary, h.args('rg', ['.'], ['x', '.']), h.root)
          expect(result.code).toBe(125)
          expect(result.stderr).toContain('program')
        })
        it('refuses protected and noncanonical operands before confinement', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          for (const operand of [
            '.env',
            'x/../allowed.txt',
            'C:outside',
            String.raw`pkg\.github\workflows\probe.txt`,
          ]) {
            const result = await native(binary, h.args('cat', [operand], [operand]), h.root)
            expect(result.code, operand).toBe(125)
            expect(result.stdout.length).toBe(0)
            expect(result.stderr).toContain('privateOperand')
          }
        })
        it('refuses symlink and hardlink escapes at the walk', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          symlinkSync(h.outside, path.join(h.workspace, 'link'))
          linkSync(h.outside, path.join(h.workspace, 'hardlink'))
          for (const name of ['link', 'hardlink']) {
            const result = await native(binary, h.args('cat', [name], [name]), h.root)
            expect(result.code, name).toBe(125)
            expect(result.stdout.length).toBe(0)
          }
        })
        it('canonicalizes seeded spellings exactly like the Linux policy', async () => {
          if (macPrereqs.variant === null) throw new Error('Missing variant')
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
          const result = await native(macPrereqs.variant, spellings, h.root)
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
        })
      })

      // The confined drills need sandbox-exec to apply a profile. The probe
      // itself proves process, network and write denial, so the drills below
      // only repeat what the profile must hold per run.
      describe.runIf(hasBinary && macPrereqs.live)('live Seatbelt drills', () => {
        it('captures ABI 1 with post-walk, process, network and write refusal', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          const result = await native(binary, ['probe'], h.root)
          expect(result.code).toBe(0)
          expect(result.stdout.toString()).toMatch(/^\{"abi":1,"confined":true\}\n$/u)
        })
        it('runs verified cat, ls, grep and find under the profile', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          for (const [program, tool] of [
            ['cat', ['allowed.txt']],
            ['ls', ['-l', '.']],
            ['grep', ['-e', 'ALLOWED', 'allowed.txt']],
            ['find', ['.', '-print']],
          ] as const) {
            const operand = tool.at(-1) === 'allowed.txt' ? 'allowed.txt' : '.'
            const result = await native(
              binary,
              h.args(program, [operand], [...tool], program === 'find'),
              h.root,
            )
            expect(result.code, `${program}: ${result.stderr}`).toBe(0)
            expect(result.stderr).toMatch(/^\{"confined":true,/u)
          }
          const cat = await native(binary, h.args('cat', ['allowed.txt'], ['allowed.txt']), h.root)
          expect(cat.stdout.toString()).toBe('ALLOWED_CANARY\n')
        })
        it('withholds protected contents but keeps their names, like Linux B1-13', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          mkdirSync(path.join(h.workspace, '.git'))
          writeFileSync(path.join(h.workspace, '.git/config'), 'FORBIDDEN_CANARY')
          const runner = new InspectRunner({
            helper: binary,
            storage: path.join(h.root, 'storage'),
            start: inspectStart,
          })
          try {
            const find = await runner.run('find . -print', h.binding)
            expect(find.kind).toBe('output')
            if (find.kind !== 'output') throw new Error('Missing confined result')
            expect(find.stdout).toContain('.git/config')
            expect(find.stdout).not.toContain('FORBIDDEN_CANARY')
            const grep = await runner.run("grep -r -e 'CANARY' .", h.binding)
            expect(grep.kind).toBe('output')
            if (grep.kind !== 'output') throw new Error('Missing confined result')
            expect(grep.stdout).toContain('ALLOWED_CANARY')
            expect(grep.stdout).not.toContain('FORBIDDEN_CANARY')
            expect(grep.excluded).toBeGreaterThan(0)
          } finally {
            await runner.dispose()
          }
        })
        it('refuses a leaf swapped after the walk at the confined open', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          const result = await native(
            binary,
            h.args('cat', ['allowed.txt'], ['allowed.txt']),
            h.root,
            () => {
              renameSync(h.allowed, `${h.allowed}.old`)
              symlinkSync(h.outside, h.allowed)
            },
          )
          expect(result.stdout.length).toBe(0)
          expect(result.code).not.toBe(0)
        })
        it('runs session self-tests once and withholds secrets before delivery', async () => {
          if (binary === null) throw new Error('Missing helper')
          const h = await fixture()
          const runner = new InspectRunner({
            helper: binary,
            storage: path.join(h.root, 'storage'),
            start: inspectStart,
          })
          try {
            const first = await runner.run('cat allowed.txt', h.binding)
            expect(first).toMatchObject({ kind: 'output', stdout: 'ALLOWED_CANARY\n', exitCode: 0 })
            writeFileSync(h.allowed, 'password = "synthetic-sensitive-canary"\n')
            expect(await runner.run('cat allowed.txt', h.binding)).toEqual({
              kind: 'refused',
              reason: 'secret',
            })
          } finally {
            await runner.dispose()
          }
        })
      })
    })
    break
  }
  case 'win32': {
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
    break
  }
  default: {
    break
  }
}
