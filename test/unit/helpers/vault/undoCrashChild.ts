// Killed-undo child: real broker client, real native store. It runs one
// retired undo and then waits for SIGKILL at the named point, after that
// point's durable write has returned. Nothing here is printed but a
// fixed status line.
import { randomBytes } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { AsyncEntry } from '@napi-rs/keyring'
import { configureResources } from '../../../../src/core/resources/admission'
import { createdPathCommands } from '../../../../src/core/resources/resourceGovernorEntry'
import { VaultFirstPartyReader } from '../../../../src/core/vault/broker/firstParty'
import { VaultManageSession } from '../../../../src/core/vault/broker/manageClient'
import { encodeVaultMaterial } from '../../../../src/core/vault/crypto'
import { chatgptSubscriptionMigrationCredential } from '../../../../src/core/vault/migrate/chatgptSubscription'
import type { SecretStore } from '../../../../src/host/auth/credentialStore'
import { CredentialMigrationController } from '../../../../src/host/vault/migrateCredentials'
import { VaultBrokerProcess } from '../../../../src/host/vault/brokerProcess'
import type { Logger } from '../../../../src/host/logger'
import { keyringSecretStore } from '../../../../src/runtime/keyStore'
import { runtimeWindowsJob } from '../../../../src/runtime/resources/jobs'
import { vaultClientPlatform } from '../../../../src/runtime/vault/clientPlatform'
import { MILLISECONDS_PER_SECOND, UI_TEXT } from '../../../../src/shared/constants'
import type { VaultItem } from '../../../../src/shared/vault'

const dataDir = path.resolve(process.argv[2] ?? '')
const installRoot = path.resolve(process.argv[3] ?? '')
const service = process.argv[4] ?? ''
const lockScope = process.argv[5] ?? ''
const stop = process.argv[6]
const sentinel = path.resolve(process.argv[7] ?? '')

function report(kind: 'hung' | 'error', detail?: string): void {
  process.stdout.write(`${JSON.stringify(detail === undefined ? { kind } : { kind, detail })}\n`)
}

/** A fixed vault sentence is safe to report. Anything else stays a name. */
function publicFailure(error: unknown): string {
  if (!(error instanceof Error)) return 'Error'
  const sentences = Object.values(UI_TEXT.vault).filter(
    (value): value is string => typeof value === 'string',
  )
  return sentences.includes(error.message) ? `${error.name}: ${error.message}` : error.name
}

/**
The journal row's undo mark, when this item is one. The row holds a
digest, not the secret. Any other item — including a credential — is
left unread beyond the parse that shows it is not a mark.
*/
function journalUndoIntent(item: VaultItem): string | undefined {
  const material = item.material
  if (material.kind !== 'apiKey' && material.kind !== 'secret') return undefined
  const text = Buffer.from(material.value).toString('utf8')
  try {
    const parsed: unknown = JSON.parse(text)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    if (!('phase' in parsed) || !('undoIntent' in parsed)) return undefined
    const { phase, undoIntent } = parsed
    return phase === 'retired' && typeof undoIntent === 'string' ? undoIntent : undefined
  } catch (error: unknown) {
    if (error instanceof SyntaxError) return undefined
    throw error
  }
}

async function hang(): Promise<never> {
  await writeFile(sentinel, 'ready', { mode: 0o600 })
  report('hung')
  return await new Promise(() => {
    setInterval(() => {
      /* Stay alive until the parent sends SIGKILL at this exact point. */
    }, MILLISECONDS_PER_SECOND)
  })
}

function hangingStore(real: SecretStore): SecretStore {
  return {
    get: (key) => real.get(key),
    delete: (key) => real.delete(key),
    async store(key, value) {
      await real.store(key, value)
      // The native write has returned. `legacy` stops before the journal
      // can record that the write was observed.
      if (stop === 'legacy') await hang()
    },
  }
}

const quiet: Logger = {
  trace: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

async function main(): Promise<void> {
  if (stop !== 'legacy' && stop !== 'written' && stop !== 'pending')
    throw new Error('undo crash stop')
  if (service === '' || lockScope === '') throw new Error('undo crash store')
  if (process.platform === 'win32') {
    configureResources({
      inspect: () => ({}),
      onError: () => undefined,
      windowsJob: runtimeWindowsJob(path.join(installRoot, 'jobs'), installRoot),
    })
  } else {
    configureResources({
      registryFile: path.join(dataDir, 'crash-admission', 'registry.json'),
      inspect: () => ({}),
      onError: () => undefined,
      createdDirectories: createdPathCommands(path.join(installRoot, 'native'), undefined),
    })
  }
  const hostId = randomBytes(16).toString('hex')
  const hostSession = randomBytes(16).toString('hex')
  const platform = await vaultClientPlatform({
    dataDir,
    distDir: path.join(installRoot, 'dist'),
    hostId,
    hostSession,
  })
  const broker = new VaultBrokerProcess(platform.discovery, platform.process)
  const connect = () => broker.connect(hostId, hostSession, platform.peers, platform.dial)
  const session = new VaultManageSession(connect, encodeVaultMaterial)
  const reader = new VaultFirstPartyReader(connect)
  const secrets = hangingStore(
    keyringSecretStore((_service, account) => new AsyncEntry(service, account), { lockScope }),
  )
  const controller = new CredentialMigrationController({
    secrets,
    listProviderIds: () => Promise.resolve([]),
    ports: {
      snapshot: () => session.snapshot(),
      remove: (...args) => session.remove(...args),
      firstPartyRead: (...args) => reader.read(...args),
      async write(item, isEdit, authorize) {
        await session.write(item, isEdit, authorize)
        const mark = journalUndoIntent(item)
        // `pending` is before the legacy write. `written` is after the
        // write was read back and before the slot is marked active.
        if (mark !== undefined && mark === stop) await hang()
      },
    },
    minorRelease: () => 21,
    now: Date.now,
    log: quiet,
    label: UI_TEXT.vault.secret,
  })
  await controller.undoRetired(chatgptSubscriptionMigrationCredential(Date.now).key)
  report('error', 'undo finished')
}

// The bundle target is CommonJS, which cannot carry a top-level await.
// The floating promise is handled; the child stays up only until the parent
// kills it at the hang, or this reports a fixed failure.
void main().catch((error: unknown) => {
  report('error', publicFailure(error))
  process.exitCode = 1
})
