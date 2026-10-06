import { execFile, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  mkdir,
  mkdtemp,
  open,
  readFile,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import { compileJob } from '../../src/host/backend/jobBuild'
import {
  invokeWindowsVault,
  type WindowsVaultTransport,
} from '../../src/runtime/vault/slots/windowsVaultProtocol'
import {
  WindowsVaultSlot,
  windowsVaultProtectionFacts,
} from '../../src/runtime/vault/slots/windowsVaultSlot'
import {
  windowsVaultGuardScript,
  windowsVaultTransport,
  type WindowsVaultExecutable,
} from '../../src/runtime/vault/slots/windowsVaultTransport'
import { UI_TEXT } from '../../src/shared/constants'
import * as z from 'zod/mini'
import type { RunProgram } from '../../src/host/processTree'

const paths = { root: '', helper: '', guards: '', trap: '' }
const owned = new Set<WindowsVaultSlot>()
const capture: {
  transport?: WindowsVaultTransport
  executable?: WindowsVaultExecutable
  reports: number
  isHardwareAvailable: boolean
  isHelloAvailable: boolean
  isDpapiAvailable: boolean
} = { reports: 0, isHardwareAvailable: false, isHelloAvailable: false, isDpapiAvailable: false }
const transport: WindowsVaultTransport = {
  exchange: (header, key) => {
    if (capture.transport === undefined) throw new Error('native capture was not prepared')
    return capture.transport.exchange(header, key)
  },
}
const sources = [
  'MuseSparkVault.cs',
  'MuseSparkVaultCng.cs',
  'MuseSparkVaultHello.cs',
  'MuseSparkVaultLock.cs',
]
function context() {
  return {
    id: randomBytes(16).toString('hex'),
    vaultId: randomBytes(16).toString('hex'),
    lastGeneration: 0,
    auditGeneration: 0,
    auditHead: '0'.repeat(64),
    createdAt: Date.now(),
  }
}

async function nativeFrame(
  file: string,
  metadata: unknown,
  privateBytes = 0,
  args: string[] = [],
  cwd?: string,
) {
  const header = Buffer.from(JSON.stringify(metadata))
  return await new Promise<Buffer>((resolve, reject) => {
    const child = spawn(file, args, { cwd, env: {}, windowsHide: true, stdio: 'pipe' })
    const chunks: Buffer[] = []
    child.on('error', reject)
    child.stdin.on('error', () => {
      /* Invalid native frames may close stdin early. */
    })
    child.stdout.on('data', (bytes: Buffer) => {
      chunks.push(bytes)
    })
    child.on('close', () => {
      resolve(Buffer.concat(chunks))
    })
    const length = Buffer.alloc(4)
    length.writeUInt32BE(header.length)
    child.stdin.write(length)
    child.stdin.end(Buffer.concat([header, Buffer.alloc(privateBytes)]))
  })
}

it('restricts every native import and startup DLL search to System32', async () => {
  const texts = await Promise.all(
    sources.map((name) => readFile(path.resolve('native/windows', name), 'utf8')),
  )
  for (const text of texts) {
    const imports = text.matchAll(/\[DllImport\(/gu)
    for (const found of imports) {
      expect(
        text
          .slice(0, found.index)
          .trimEnd()
          .endsWith('[DefaultDllImportSearchPaths(DllImportSearchPath.System32)]'),
      ).toBe(true)
    }
  }
  expect(texts[0]).toContain('System32Search = 0x800')
  expect(texts[0]).toContain(
    'if (!SetDefaultDllDirectories(System32Search)) throw new InvalidOperationException();',
  )
  expect(texts[0]?.indexOf('if (!SetDefaultDllDirectories')).toBeLessThan(
    texts[0]?.indexOf('Console.OpenStandardInput()') ?? 0,
  )
})

describe.runIf(process.platform === 'win32')(
  'Windows native vault capture: generated material only',
  () => {
    beforeAll(async () => {
      paths.root = await mkdtemp(path.join(tmpdir(), 'muse-vault-native-'))
      const contents = await Promise.all(
        sources.map((name) => readFile(path.resolve('native/windows', name), 'utf8')),
      )
      const source = contents.join('\n')
      const executable = await windowsVaultExecutable({
        storageDir: paths.root,
        systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
        readSource: () => Promise.resolve(source),
        report: () => {
          capture.reports += 1
        },
      })
      capture.executable = executable
      paths.helper = executable.file
      capture.transport = windowsVaultTransport(executable)
      const facts = await windowsVaultProtectionFacts(transport)
      capture.isHardwareAvailable = facts.hardwareAvailable
      capture.isHelloAvailable = facts.helloAvailable
      capture.isDpapiAvailable = facts.osStoreAvailable
      const harness = await readFile(
        path.resolve('test/unit/helpers/vault/windowsVaultGuardCapture.cs'),
        'utf8',
      )
      const memoryKsp = await readFile(
        path.resolve('test/unit/helpers/vault/windowsVaultMemoryKsp.cs'),
        'utf8',
      )
      const memoryDpapi = await readFile(
        path.resolve('test/unit/helpers/vault/windowsVaultMemoryDpapi.cs'),
        'utf8',
      )
      const memoryHello = await readFile(
        path.resolve('test/unit/helpers/vault/windowsVaultMemoryHello.cs'),
        'utf8',
      )
      const guardedSource = contents
        .map((text, index) => {
          switch (index) {
            case 0: {
              return text
                .replaceAll('ProtectedData.Protect(', 'VaultMemoryDpapi.Protect(')
                .replaceAll('ProtectedData.Unprotect(', 'VaultMemoryDpapi.Unprotect(')
            }
            case 1: {
              return text
                .replaceAll('CngKey.Create(', 'VaultMemoryKsp.Create(')
                .replaceAll('CngKey.Exists(', 'VaultMemoryKsp.Exists(')
                .replaceAll('CngKey.Open(', 'VaultMemoryKsp.Open(')
                .replace(
                  'using (var key = VaultMemoryKsp.Open(name, Provider, CngKeyOpenOptions.Silent)) key.Delete();',
                  'VaultMemoryKsp.Delete(name);',
                )
            }
            case 2: {
              return text
                .replace(
                  '{ return Type.GetType(name + ", Windows, ContentType=WindowsRuntime", true); }',
                  '{ return VaultMemoryHello.Runtime(name); }',
                )
                .replace('DeadlineMilliseconds = 120000', 'DeadlineMilliseconds = 40')
                .replace('Environment.UserInteractive', 'VaultMemoryHello.UserInteractive')
                .replace('new Form', 'new VaultMemoryWindow')
            }
            case 3: {
              return text
                .replace(
                  'WTSRegisterSessionNotification(handle, NotifyThisSession)',
                  'VaultMemoryLock.Register(handle, NotifyThisSession)',
                )
                .replace(
                  'WTSUnRegisterSessionNotification(handle)',
                  'VaultMemoryLock.Unregister(handle)',
                )
                .replace('Application.Run(window)', 'VaultMemoryLock.Run(window)')
            }
            default: {
              return text
            }
          }
        })
        .join('\n')
      const run: RunProgram = (file, args, env) =>
        new Promise((resolve, reject) => {
          execFile(
            file,
            [...args],
            { cwd: path.dirname(file), env, windowsHide: true },
            (error, stdout) => {
              if (error === null) resolve(stdout)
              else reject(new Error('native test compilation failed'))
            },
          )
        })
      const guards = await windowsVaultExecutable({
        storageDir: paths.root,
        systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
        readSource: () =>
          Promise.resolve([guardedSource, memoryKsp, memoryDpapi, memoryHello, harness].join('\n')),
        run: (file, args, env) =>
          run(file, [...args, '/main:MuseSparkVaultNative.VaultGuardCapture'], env),
      })
      paths.guards = guards.file
      paths.trap = path.join(paths.root, 'dll-trap.dll')
      await compileJob(
        {
          stem: 'trap',
          extension: '.dll',
          outputType: 'library',
          references: [],
          label: 'test DLL',
          isPresent: () => Promise.resolve(false),
        },
        paths.trap,
        'public static class VaultDllTrap {}',
        process.env['SystemRoot'] ?? String.raw`C:\Windows`,
        (file, args) => run(file, args, {}),
      )
    })
    afterAll(async () => {
      try {
        for (const slot of owned) await slot.remove()
      } finally {
        if (paths.root !== '') await rm(paths.root, { recursive: true, force: true })
      }
    })

    it('captures PCP RSA/ECC and Hello availability without opening any credential', async () => {
      const result = await invokeWindowsVault(transport, { v: 1, operation: 'probe' })
      expect(typeof result.probe?.rsa).toBe('boolean')
      expect(typeof result.probe?.ecc).toBe('boolean')
      expect(typeof result.probe?.hello).toBe('boolean')
      expect(typeof result.probe?.dpapi).toBe('boolean')
    })
    it('creates private helper directories with protected ACLs', async () => {
      const helper = capture.executable
      if (helper === undefined) throw new Error('capture missing')
      const directory = path.dirname(helper.file).replaceAll("'", "''")
      const script = `[Console]::WriteLine([IO.Directory]::GetAccessControl('${directory}').AreAccessRulesProtected.ToString().ToLowerInvariant())`
      const output = await new Promise<string>((resolve, reject) => {
        execFile(
          helper.powershell,
          [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(script, 'utf16le').toString('base64'),
          ],
          { cwd: path.dirname(helper.powershell), env: {}, windowsHide: true },
          (error, stdout) => {
            if (error === null) resolve(stdout)
            else reject(new Error('ACL capture failed'))
          },
        )
      })
      const raw: unknown = JSON.parse(output)
      expect(z.boolean().parse(raw)).toBe(true)
    })
    it.each(['file', 'directory', 'parent'])(
      'refuses a foreign owner on %s without changing any filesystem owner',
      async (kind) => {
        const helper = capture.executable
        if (helper === undefined) throw new Error('capture missing')
        let targetPath = helper.file
        if (kind !== 'file') targetPath = path.dirname(targetPath)
        if (kind === 'parent') targetPath = path.dirname(targetPath)
        const target = targetPath.replaceAll("'", "''")
        // Only this test copy changes the ACL object's owner in memory; all on-disk permissions stay real.
        const script = windowsVaultGuardScript(helper.file, helper.sha256).replace(
          '$acl = Get-Acl -LiteralPath $name',
          () =>
            `$acl = Get-Acl -LiteralPath $name; if ($name -eq '${target}') { $acl.SetOwner((New-Object Security.Principal.SecurityIdentifier('S-1-1-0'))) }`,
        )
        const output = await nativeFrame(helper.powershell, { v: 1, operation: 'probe' }, 0, [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ])
        expect(output).toHaveLength(0)
      },
    )
    it('refuses a same-name replacement on every launch and rebuilds without deleting it', async () => {
      const helper = capture.executable
      if (helper === undefined) throw new Error('capture missing')
      const previous = helper.file
      const original = await readFile(previous)
      const replacement = await readFile(paths.guards)
      const reports = capture.reports
      try {
        await writeFile(previous, replacement)
        await expect(invokeWindowsVault(transport, { v: 1, operation: 'probe' })).rejects.toThrow(
          UI_TEXT.vault.noAccess,
        )
        expect(helper.file).not.toBe(previous)
        expect(await readFile(previous)).toEqual(replacement)
        expect(capture.reports).toBe(reports + 1)
        await expect(
          invokeWindowsVault(transport, { v: 1, operation: 'probe' }),
        ).resolves.toMatchObject({ probe: { rsa: capture.isHardwareAvailable } })
      } finally {
        await writeFile(previous, original)
      }
    })
    it.each([
      ['file', 'Modify'],
      ['directory', 'Modify'],
      ['file', 'ChangePermissions'],
      ['directory', 'ChangePermissions'],
      ['file', 'TakeOwnership'],
      ['directory', 'TakeOwnership'],
      ['parent', 'DeleteSubdirectoriesAndFiles'],
    ])('refuses an untrusted %s ACL with %s and leaves it in place', async (kind, rights) => {
      const helper = capture.executable
      if (helper === undefined) throw new Error('capture missing')
      const previous = helper.file
      let target = previous
      if (kind !== 'file') target = path.dirname(target)
      if (kind === 'parent') target = path.dirname(target)
      const setRule = async (isRemove: boolean) => {
        const script = `$target = '${target.replaceAll("'", "''")}'; $acl = Get-Acl -LiteralPath $target; $sid = New-Object Security.Principal.SecurityIdentifier('S-1-1-0'); $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, '${rights}', 'Allow'); $acl.${isRemove ? 'RemoveAccessRuleAll' : 'AddAccessRule'}($rule); Set-Acl -LiteralPath $target -AclObject $acl`
        await new Promise<void>((resolve, reject) => {
          execFile(
            helper.powershell,
            [
              '-NoProfile',
              '-NonInteractive',
              '-EncodedCommand',
              Buffer.from(script, 'utf16le').toString('base64'),
            ],
            { env: {}, windowsHide: true },
            (error) => {
              if (error === null) resolve()
              else reject(new Error('test ACL change failed'))
            },
          )
        })
      }
      try {
        await setRule(false)
        if (kind === 'parent') {
          const output = await nativeFrame(helper.powershell, { v: 1, operation: 'probe' }, 0, [
            '-NoProfile',
            '-NonInteractive',
            '-EncodedCommand',
            Buffer.from(windowsVaultGuardScript(previous, helper.sha256), 'utf16le').toString(
              'base64',
            ),
          ])
          expect(output).toHaveLength(0)
        } else {
          await expect(invokeWindowsVault(transport, { v: 1, operation: 'probe' })).rejects.toThrow(
            UI_TEXT.vault.noAccess,
          )
          expect(helper.file).not.toBe(previous)
        }
        const retained = await readFile(previous)
        expect(retained.length).toBeGreaterThan(0)
      } finally {
        await setRule(true)
      }
    })
    it('refuses a junction in the helper path and rebuilds without touching its target', async () => {
      const helper = capture.executable
      if (helper === undefined) throw new Error('capture missing')
      const previous = helper.file
      const directory = path.dirname(previous)
      const moved = `${directory}-original`
      await rename(directory, moved)
      try {
        await symlink(moved, directory, 'junction')
        await expect(invokeWindowsVault(transport, { v: 1, operation: 'probe' })).rejects.toThrow(
          UI_TEXT.vault.noAccess,
        )
        expect(helper.file).not.toBe(previous)
        const retained = await readFile(path.join(moved, path.basename(previous)))
        expect(retained.length).toBeGreaterThan(0)
      } finally {
        await rmdir(directory)
        await rename(moved, directory)
      }
    })
    it('holds the verified executable against writes and deletion across the launch action', async () => {
      const helper = capture.executable
      if (helper === undefined) throw new Error('capture missing')
      // Pause the launch action before CLR loading, so its own assembly locks cannot mask a broken verifier handle.
      const script = windowsVaultGuardScript(helper.file, helper.sha256)
        .replace('$entry = [Reflection.Assembly]::LoadFile($target).EntryPoint', '$entry = $null')
        .replace(
          '$result = $entry.Invoke($null, [object[]]@(,[string[]]@()))',
          '$result = [Console]::OpenStandardInput().ReadByte()',
        )
      const child = spawn(
        helper.powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { env: {}, windowsHide: true, stdio: 'pipe' },
      )
      const closed = new Promise<void>((resolve) => {
        child.once('close', () => {
          resolve()
        })
      })
      try {
        await new Promise<void>((resolve, reject) => {
          child.once('error', reject)
          child.stdout.once('data', (bytes: Buffer) => {
            if (bytes[0] === 1) resolve()
            else reject(new Error('verification failed'))
          })
          child.once('close', () => {
            reject(new Error('verification closed'))
          })
        })
        let isWritable = false
        try {
          const handle = await open(helper.file, 'r+')
          await handle.close()
          isWritable = true
        } catch {
          /* Sharing refusal is the expected result. */
        }
        expect(isWritable).toBe(false)
        let canRename = false
        try {
          await rename(helper.file, `${helper.file}.moved`)
          await rename(`${helper.file}.moved`, helper.file)
          canRename = true
        } catch {
          /* Sharing refusal is the expected result. */
        }
        expect(canRename).toBe(false)
      } finally {
        child.kill('SIGKILL')
        await closed
      }
    })
    it('does not load a planted ncrypt DLL beside the helper or in its working directory', async () => {
      const working = path.join(paths.root, 'dll-working')
      await mkdir(working)
      // A real DLL with no native exports loads but cannot serve ncrypt: selecting it must refuse probe.
      const trap = await readFile(paths.trap)
      const beside = path.join(path.dirname(paths.guards), 'ncrypt.dll')
      const inWorking = path.join(working, 'ncrypt.dll')
      try {
        await writeFile(beside, trap)
        await writeFile(inWorking, trap)
        // The fixture calls the original native Main, then emits only public module-presence booleans.
        const result = await nativeFrame(
          paths.guards,
          { v: 1, operation: 'probe' },
          0,
          ['dllCapture'],
          working,
        )
        const headerLength = result.readUInt32BE()
        const raw: unknown = JSON.parse(result.subarray(4, 4 + headerLength).toString('utf8'))
        expect(
          z.object({ status: z.literal('ok'), rsa: z.boolean(), ecc: z.boolean() }).parse(raw)
            .status,
        ).toBe('ok')
        const captureFrame = result.subarray(4 + headerLength)
        const modules: unknown = JSON.parse(captureFrame.subarray(4).toString('utf8'))
        expect(
          z
            .strictObject({ systemNcryptLoaded: z.boolean(), foreignNcryptLoaded: z.boolean() })
            .parse(modules),
        ).toEqual({ systemNcryptLoaded: true, foreignNcryptLoaded: false })
      } finally {
        await rm(beside, { force: true })
        await rm(inWorking, { force: true })
      }
    })
    it('refuses invalid DPAPI wrap title and use before the wrapping branch', async () => {
      const valid = {
        v: 1,
        operation: 'wrap',
        identity: { slotId: '1'.repeat(32), vaultId: '2'.repeat(32), tier: 'osStore' },
        title: 'test',
        use: 'test',
      }
      // This entry uses the existing test-only DPAPI stand-in so OS availability cannot mask a missing guard.
      const baseline = await nativeFrame(paths.guards, valid, 32, ['protocol'])
      expect(baseline.subarray(4).toString('utf8')).toContain('"status":"ok"')
      for (const field of ['title', 'use']) {
        for (const invalid of [null, 123, '', 'line\nbreak', 'nul\0value']) {
          const result = await nativeFrame(paths.guards, { ...valid, [field]: invalid }, 32, [
            'protocol',
          ])
          expect(result.subarray(4).toString('utf8')).toBe(
            '{"v":1,"status":"error","code":"refused"}',
          )
          result.fill(0)
        }
      }
      baseline.fill(0)
    })
    it('proves native guards with ephemeral software test keys, never claiming TPM presence', async () => {
      const stdout = await new Promise<string>((resolve, reject) => {
        execFile(paths.guards, [], { env: {}, windowsHide: true }, (error, text) => {
          if (error === null) resolve(text)
          else reject(new Error('native guard capture failed'))
        })
      })
      const raw: unknown = JSON.parse(stdout)
      const guards = z.record(z.string(), z.boolean()).parse(raw)
      expect(guards).toEqual({
        identityAcceptsOwn: true,
        identityRefusesForeign: true,
        identityRefusesTier: true,
        formatRefusesVersion: true,
        formatRefusesCoercion: true,
        fieldsRefuseExtra: true,
        fieldsRefuseMissing: true,
        textRefuses0: true,
        textRefuses1: true,
        textRefuses2: true,
        textRefuses3: true,
        textRefuses4: true,
        bytesRefuseLength: true,
        bytesRefuseNoncanonical: true,
        providerRefusesSoftware: true,
        validRsaAccepted: true,
        presenceRefusesUnprotected: true,
        sizeRefusesWeakRsa: true,
        exportRefusesExportable: true,
        usageRefusesSigning: true,
        algorithmRefusesEccWrap: true,
        oaepRoundtrip: true,
        overwriteRefused: true,
        privateExportRefused: true,
        currentUserKey: true,
        currentUserCreation: true,
        oaepSha256Verified: true,
        dpapiOwnedRoundtrip: true,
        dpapiIdentityBound: true,
        dpapiCurrentUser: true,
        oaepTamperRefused: true,
        generatedKeyDeleted: true,
        helloSupported: true,
        helloSupportRefused: true,
        helloInteractiveRefused: true,
        helloSilentNoWindow: true,
        helloAsyncFailureRefused: true,
        helloDeadlineCanceled: true,
        helloOperationClosed: true,
        helloCredentialFailureRefused: true,
        helloCreationNoOverwrite: true,
        helloFailedCreationCleaned: true,
        helloPssVerified: true,
        helloPkcs1Verified: true,
        helloUseChallengeBound: true,
        helloFreshSignEveryUse: true,
        helloForeignKeyRefused: true,
        helloSignFailureRefused: true,
        helloBadSignatureRefused: true,
        lockSubscriptionFailureRefused: true,
        lockSubscriptionReleased: true,
        lockForeignMessageIgnored: true,
        lockOtherEventIgnored: true,
        lockOwnEventClosed: true,
      })
    })
    it('roundtrips a generated DPAPI key or explicitly refuses unavailable current-user protection', async () => {
      const slot = new WindowsVaultSlot('osStore', context(), transport)
      const key = randomBytes(32)
      let actual: Uint8Array | undefined
      try {
        if (!capture.isDpapiAvailable) {
          await expect(slot.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
          return
        }
        const record = await slot.wrap(key)
        expect(record.wrappedKey).not.toContain(key.toString('base64'))
        actual = await slot.unwrap(record, 'Generated DPAPI capture')
        expect(actual).toEqual(key)
      } finally {
        key.fill(0)
        actual?.fill(0)
        await slot.remove()
      }
    })
    it('refuses a DPAPI blob rebound to a different slot identity', async () => {
      const first = new WindowsVaultSlot('osStore', context(), transport)
      const second = new WindowsVaultSlot('osStore', context(), transport)
      const key = randomBytes(32)
      try {
        if (!capture.isDpapiAvailable) {
          await expect(first.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
          await expect(second.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
          return
        }
        const record = await first.wrap(key)
        const raw: unknown = JSON.parse(Buffer.from(record.wrappedKey, 'base64').toString('utf8'))
        const { windowsVaultContainerSchema } =
          await import('../../src/runtime/vault/slots/windowsVaultProtocol')
        const container = windowsVaultContainerSchema.parse(raw)
        const other = await second.wrap(key)
        const identity = { slotId: other.id, vaultId: other.vaultId, tier: 'osStore' }
        const changed = {
          ...other,
          wrappedKey: Buffer.from(JSON.stringify({ ...container, identity })).toString('base64'),
        }
        await expect(second.unwrap(changed, 'DPAPI identity swap')).rejects.toThrow(
          UI_TEXT.vault.noAccess,
        )
      } finally {
        key.fill(0)
      }
    })
    it('wraps with real PCP RSA OAEP or explicitly refuses unavailable hardware', async () => {
      const slot = new WindowsVaultSlot('hardware', context(), transport)
      const key = randomBytes(32)
      let actual: Uint8Array | undefined
      try {
        if (!capture.isHardwareAvailable) {
          await expect(slot.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
          return
        }
        const record = await slot.wrap(key)
        owned.add(slot)
        actual = await slot.unwrap(record, 'Generated TPM capture')
        expect(actual).toEqual(key)
        // Refuse overwrite: never replace a key already at the derived identity.
        await expect(slot.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
        await slot.remove()
        owned.delete(slot)
        await expect(slot.unwrap(record, 'Deleted TPM slot')).rejects.toThrow(
          UI_TEXT.vault.noAccess,
        )
      } finally {
        key.fill(0)
        actual?.fill(0)
      }
    })
    it('never prompts or creates a presence key where Hello is unavailable', async () => {
      // Capable machines exercise their interactive prompts only in owner-click captures.
      if (capture.isHelloAvailable) {
        const facts = await windowsVaultProtectionFacts(transport)
        expect(facts.helloAvailable).toBe(true)
        return
      }
      const slot = new WindowsVaultSlot('presence', context(), transport)
      const key = randomBytes(32)
      try {
        await expect(slot.wrap(key)).rejects.toThrow(UI_TEXT.vault.noAccess)
      } finally {
        key.fill(0)
      }
    })
    it('rejects malformed native requests and extra private bytes with fixed diagnostics', async () => {
      const validWrap = {
        v: 1,
        operation: 'wrap',
        identity: { slotId: '1'.repeat(32), vaultId: '2'.repeat(32), tier: 'osStore' },
        title: 'test',
        use: 'test',
      }
      for (const input of [
        { v: 2, operation: 'probe' },
        { v: 1, operation: 'probe', extra: 'canary' },
        {
          v: 1,
          operation: 'wrap',
          identity: { slotId: '../canary', vaultId: '2'.repeat(32), tier: 'osStore' },
          title: 'test',
          use: 'test',
        },
        { v: 1, operation: 'probe', privateBytes: 1 },
        { ...validWrap, privateBytes: 33 },
        { ...validWrap, title: 'é'.repeat(2200), privateBytes: 32 },
        { v: 1, operation: 'unknown', identity: validWrap.identity },
      ]) {
        // Direct framing bypasses TS validation to test the native boundary.
        const privateBytes = 'privateBytes' in input ? input.privateBytes : 0
        const metadata = Object.fromEntries(
          Object.entries(input).filter(([name]) => name !== 'privateBytes'),
        )
        const result = await nativeFrame(paths.helper, metadata, privateBytes)
        expect(result.subarray(4).toString('utf8')).toBe(
          '{"v":1,"status":"error","code":"refused"}',
        )
        result.fill(0)
      }
    })
  },
)
