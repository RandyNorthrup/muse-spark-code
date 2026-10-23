import { execFile, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  darwinPeerDependencies,
  darwinProcessLease,
  requireDarwinInstallation,
} from '../../src/core/judge/local/darwinPeer'

const execute = promisify(execFile)
const helper = path.resolve('native/darwin/muse-local-judge-peer')
const predicates = path.resolve('temp/m98-j3/darwin-predicates')
const uid = process.getuid?.() ?? -1
const signal = () => new AbortController().signal

describe.skipIf(process.platform !== 'darwin')('M98 macOS native proofs', () => {
  beforeAll(async () => {
    await mkdir(path.resolve('temp/m98-j3'), { recursive: true })
    await execute('/bin/bash', ['native/darwin/build-local-judge.sh'], {
      env: { PATH: '/usr/bin:/bin' },
    })
    await execute(
      '/usr/bin/xcrun',
      [
        'clang',
        '-std=c11',
        '-Wall',
        '-Wextra',
        '-Werror',
        'test/unit/helpers/localJudgeDarwin.c',
        '-lproc',
        '-o',
        predicates,
      ],
      { env: {} },
    )
  })
  it.each([
    'apfs',
    'hfs',
    'smbfs',
    'nfs',
    'afpfs',
    'webdav',
    'macfuse',
    'fusefs',
    'overlay',
    'exfat',
    'nonlocal',
    'union',
  ])('checks native volume %s', async (type) => {
    await expect(execute(predicates, ['volume', type], { env: {} })).resolves.toMatchObject({
      stdout: '',
    })
  })
  it.each(['pid', 'uid', 'realUid', 'seconds', 'microseconds', 'path'])(
    'refuses reused/changed identity %s',
    async (field) => {
      await expect(execute(predicates, ['generation', field], { env: {} })).resolves.toMatchObject({
        stdout: '',
      })
    },
  )
  it.each(['uid', 'realUid', 'pid', 'start', 'microseconds', 'zombie', 'info', 'path'])(
    'refuses invalid libproc sample %s',
    async (field) => {
      await expect(execute(predicates, ['sample', field], { env: {} })).resolves.toMatchObject({
        stdout: '',
      })
    },
  )
  it('refuses a native foreign-owned root', async () => {
    await expect(execute(helper, ['volume', '/usr/bin'], { env: {} })).rejects.toThrow()
  })
  it('holds exact libproc identity, watches exit and cannot rebind', async () => {
    const child = spawn('/bin/sleep', ['30'], { env: {}, stdio: 'ignore' })
    await once(child, 'spawn')
    const pid = child.pid
    if (!pid) throw new Error('missing fixture pid')
    const lease = await darwinProcessLease(helper, pid, signal())
    try {
      expect(await lease.identity()).toMatchObject({ pid, uid, executable: '/bin/sleep' })
      expect(await lease.identity()).toHaveProperty(
        'creationTime',
        expect.stringMatching(/^\d{16}$/),
      )
      expect(await lease.isAlive()).toBe(true)
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      expect(await lease.isAlive()).toBe(false)
      expect(await lease.isAlive()).toBe(false)
      await expect(lease.identity()).rejects.toThrow('unverified-darwin-lifetime')
    } finally {
      child.kill('SIGKILL')
      await lease.close()
    }
  })
  it('invalidates exec even when the watched PID survives', async () => {
    const child = spawn('/bin/sh', ['-c', "read line; exec /bin/sh -c 'read line'"], {
      env: {},
      stdio: ['pipe', 'ignore', 'ignore'],
    })
    await once(child, 'spawn')
    if (!child.pid) throw new Error('missing fixture pid')
    const lease = await darwinProcessLease(helper, child.pid, signal())
    try {
      expect(await lease.isAlive()).toBe(true)
      child.stdin.write('go\n')
      // Await the actual executable change instead of assuming scheduler timing.
      for (let attempt = 0; attempt < 100; attempt++) {
        if (!(await lease.isAlive())) return
      }
      throw new Error('exec watch never invalidated')
    } finally {
      child.kill('SIGKILL')
      await lease.close()
    }
  })
  it('refuses absent, invisible and invalid processes/helpers', async () => {
    for (const pid of [0, -1, 2_147_483_647, 1])
      await expect(darwinProcessLease(helper, pid, signal())).rejects.toThrow()
    await expect(darwinProcessLease('/missing/helper', process.pid, signal())).rejects.toThrow()
  })
  it('bounds pending helper reads with cancellation and deadlines', async () => {
    const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/stall-')))
    const stall = path.join(directory, 'helper')
    await writeFile(stall, '#!/bin/sh\nexec /bin/sleep 30\n')
    await chmod(stall, 0o700)
    try {
      for (const abort of [AbortSignal.timeout(20), AbortSignal.abort()])
        await expect(darwinProcessLease(stall, process.pid, abort)).rejects.toThrow()
      const controller = new AbortController()
      const pending = darwinProcessLease(stall, process.pid, controller.signal)
      controller.abort()
      await expect(pending).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true })
    }
  })
  it.each(['pid', 'uid', 'realUid', 'generation', 'malformed', 'oversized', 'exit'])(
    'refuses helper %s faults and closes its process',
    async (fault) => {
      const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/protocol-')))
      const file = path.join(directory, 'helper')
      const initial = {
        pid: process.pid,
        uid,
        realUid: uid,
        creationTime: '1791227123536208',
        executable: '/native/ollama',
      }
      switch (fault) {
        case 'pid': {
          initial.pid++
          break
        }
        case 'uid': {
          initial.uid++
          initial.realUid++
          break
        }
        case 'realUid': {
          initial.realUid++
          break
        }
      }
      const program =
        new Map([
          ['malformed', String.raw`process.stdout.write('invalid\n')`],
          [
            'oversized',
            String.raw`const value = ${JSON.stringify(initial)}; value.executable = 'x'.repeat(70000); process.stdout.write(JSON.stringify(value) + '\n'); process.stdin.resume()`,
          ],
          ['exit', 'process.exit(0)'],
        ]).get(fault) ??
        String.raw`const value = ${JSON.stringify(initial)}; process.stdout.write(JSON.stringify(value) + '\n'); process.stdin.on('data', () => { value.creationTime = '1791227123536209'; process.stdout.write(JSON.stringify(value) + '\n') });`
      await writeFile(file, `#!${process.execPath}\n${program}\n`)
      await chmod(file, 0o700)
      let acquired: Awaited<ReturnType<typeof darwinProcessLease>> | undefined
      try {
        if (fault === 'generation') {
          const lease = await darwinProcessLease(file, process.pid, signal())
          try {
            await expect(lease.identity()).rejects.toThrow('unverified-darwin-generation')
          } finally {
            await lease.close()
          }
        } else {
          const acquire = async () => {
            acquired = await darwinProcessLease(file, process.pid, signal())
            return acquired
          }
          await expect(acquire()).rejects.toThrow()
        }
      } finally {
        await acquired?.close()
        await rm(directory, { recursive: true })
      }
    },
  )
  it('proves local owned roots and refuses links, insecure ownership modes and scope changes', async () => {
    const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/volume-')))
    const installation = {
      platform: 'darwin' as const,
      executable: '/unused/ollama',
      executableDigest: '',
      uid,
      modelDirectory: directory,
    }
    const deps = darwinPeerDependencies(helper, installation)
    try {
      await deps.verifyLocalVolume(directory, 'darwin', signal())
      await expect(deps.verifyLocalVolume(directory, 'linux', signal())).rejects.toThrow(
        'unverified',
      )
      await symlink(directory, path.join(directory, 'redirect'))
      await expect(deps.verifyLocalVolume(directory, 'darwin', signal())).rejects.toThrow(
        'unverified',
      )
      await rm(path.join(directory, 'redirect'))
      await writeFile(path.join(directory, 'writable'), 'synthetic model bytes')
      await chmod(path.join(directory, 'writable'), 0o777)
      await expect(deps.verifyLocalVolume(directory, 'darwin', signal())).rejects.toThrow(
        'unverified-model-volume',
      )
      await rm(path.join(directory, 'writable'))
      await chmod(directory, 0o777)
      await expect(deps.verifyLocalVolume(directory, 'darwin', signal())).rejects.toThrow()
    } finally {
      await chmod(directory, 0o700)
      await rm(directory, { recursive: true })
    }
  })
  it('refuses unsigned, mislocated and writable app anchors', async () => {
    const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/install-')))
    const executable = path.join(directory, 'Ollama.app/Contents/Resources/ollama')
    await mkdir(path.dirname(executable), { recursive: true })
    await writeFile(executable, 'unsigned runtime fixture')
    const installation = {
      platform: 'darwin' as const,
      executable,
      executableDigest: '',
      uid,
      modelDirectory: directory,
    }
    try {
      await expect(
        requireDarwinInstallation({ ...installation, executable: '/renamed/ollama' }, signal()),
      ).rejects.toThrow('unverified-darwin-installation')
      await chmod(executable, 0o777)
      await expect(requireDarwinInstallation(installation, signal())).rejects.toThrow(
        'unverified-darwin-anchor',
      )
      await chmod(executable, 0o700)
      await expect(requireDarwinInstallation(installation, signal())).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true })
    }
  })
  it('refuses ad-hoc signatures impersonating the Ollama identifiers', async () => {
    const directory = await realpath(await mkdtemp(path.resolve('temp/m98-j3/signed-')))
    const app = path.join(directory, 'Ollama.app')
    const executable = path.join(app, 'Contents/Resources/ollama')
    try {
      await mkdir(path.dirname(executable), { recursive: true })
      await mkdir(path.join(app, 'Contents/MacOS'))
      await copyFile('/bin/sleep', executable)
      await copyFile('/bin/sleep', path.join(app, 'Contents/MacOS/Ollama'))
      await writeFile(
        path.join(app, 'Contents/Info.plist'),
        '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleExecutable</key><string>Ollama</string><key>CFBundleIdentifier</key><string>com.electron.ollama</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>',
      )
      await execute(
        '/usr/bin/codesign',
        ['--force', '--sign', '-', '--identifier', 'ai.ollama.ollama', executable],
        { env: {} },
      )
      await execute(
        '/usr/bin/codesign',
        ['--force', '--sign', '-', '--identifier', 'com.electron.ollama', app],
        { env: {} },
      )
      // Both pass plain --verify: the Apple/team/identifier requirement must refuse.
      await execute('/usr/bin/codesign', ['--verify', '--strict', app], { env: {} })
      await execute('/usr/bin/codesign', ['--verify', '--strict', executable], { env: {} })
      await expect(
        requireDarwinInstallation(
          {
            platform: 'darwin',
            executable,
            executableDigest: createHash('sha256')
              .update(await readFile(executable))
              .digest('hex'),
            uid,
            modelDirectory: directory,
          },
          signal(),
        ),
      ).rejects.toThrow()
    } finally {
      await rm(directory, { recursive: true })
    }
  })
})
