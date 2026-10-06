import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { windowsVaultExecutable } from '../../src/host/vault/slots/windowsVaultBuild'
import {
  invokeWindowsVault,
  type WindowsVaultTransport,
} from '../../src/runtime/vault/slots/windowsVaultProtocol'
import {
  WindowsVaultSlot,
  windowsVaultProtectionFacts,
} from '../../src/runtime/vault/slots/windowsVaultSlot'
import { windowsVaultTransport } from '../../src/runtime/vault/slots/windowsVaultTransport'
import { UI_TEXT } from '../../src/shared/constants'
import * as z from 'zod/mini'
import type { RunProgram } from '../../src/host/processTree'

const paths = { root: '', helper: '', guards: '' }
const owned = new Set<WindowsVaultSlot>()
const capture: {
  transport?: WindowsVaultTransport
  isHardwareAvailable: boolean
  isHelloAvailable: boolean
  isDpapiAvailable: boolean
} = { isHardwareAvailable: false, isHelloAvailable: false, isDpapiAvailable: false }
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

describe.runIf(process.platform === 'win32')(
  'Windows native vault capture: generated material only',
  () => {
    beforeAll(async () => {
      paths.root = await mkdtemp(path.join(tmpdir(), 'muse-vault-native-'))
      const contents = await Promise.all(
        sources.map((name) => readFile(path.resolve('native/windows', name), 'utf8')),
      )
      const source = contents.join('\n')
      paths.helper = await windowsVaultExecutable({
        storageDir: paths.root,
        systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
        readSource: () => Promise.resolve(source),
      })
      capture.transport = windowsVaultTransport(paths.helper)
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
      const guardedSource = contents
        .map((text, index) => {
          if (index === 0)
            return text
              .replaceAll('ProtectedData.Protect(', 'VaultMemoryDpapi.Protect(')
              .replaceAll('ProtectedData.Unprotect(', 'VaultMemoryDpapi.Unprotect(')
          return index === 1
            ? text
                .replaceAll('CngKey.Create(', 'VaultMemoryKsp.Create(')
                .replaceAll('CngKey.Exists(', 'VaultMemoryKsp.Exists(')
                .replaceAll('CngKey.Open(', 'VaultMemoryKsp.Open(')
                .replace(
                  'using (var key = VaultMemoryKsp.Open(name, Provider, CngKeyOpenOptions.Silent)) key.Delete();',
                  'VaultMemoryKsp.Delete(name);',
                )
            : text
        })
        .join('\n')
      const run: RunProgram = (file, args, env) =>
        new Promise((resolve, reject) => {
          execFile(
            file,
            [...args, '/main:MuseSparkVaultNative.VaultGuardCapture'],
            { env, windowsHide: true },
            (error, stdout) => {
              if (error === null) resolve(stdout)
              else reject(new Error('native test compilation failed'))
            },
          )
        })
      paths.guards = await windowsVaultExecutable({
        storageDir: paths.root,
        systemRoot: process.env['SystemRoot'] ?? String.raw`C:\Windows`,
        readSource: () =>
          Promise.resolve(guardedSource + '\n' + memoryKsp + '\n' + memoryDpapi + '\n' + harness),
        run,
      })
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
        const header = Buffer.from(JSON.stringify(metadata))
        const { spawn } = await import('node:child_process')
        const result = await new Promise<Buffer>((resolve, reject) => {
          const child = spawn(paths.helper, [], { env: {}, windowsHide: true, stdio: 'pipe' })
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
        expect(result.subarray(4).toString('utf8')).toBe(
          '{"v":1,"status":"error","code":"refused"}',
        )
        result.fill(0)
      }
    })
  },
)
