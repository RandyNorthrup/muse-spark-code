import { type Readable, type Writable } from 'node:stream'
import { type Socket } from 'node:net'
import { UI_TEXT, VAULT_LIMITS } from '../../../shared/constants'
import { vaultExecEnvelopeSchema, type VaultExecEnvelope } from './schema'
import { runVaultFeeder, type VaultExecFeederPort } from './feeder'
import { callVaultExecHelper } from './helpers'

/** Own every copied frame and erase incoming chunks on both success and refusal. */
async function readPrivatePipe(pipe: Readable, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  let joined: Buffer | undefined
  try {
    for await (const chunk of pipe) {
      if (!(chunk instanceof Buffer)) throw new Error(UI_TEXT.vault.noAccess)
      total += chunk.length
      if (total > limit) {
        chunk.fill(0)
        throw new Error(UI_TEXT.vault.noAccess)
      }
      const copy = Buffer.alloc(chunk.length)
      copy.set(chunk)
      chunks.push(copy)
      chunk.fill(0)
    }
    joined = Buffer.alloc(total)
    let offset = 0
    for (const bytes of chunks) {
      joined.set(bytes, offset)
      offset += bytes.length
    }
    return joined
  } catch {
    joined?.fill(0)
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    for (const bytes of chunks) bytes.fill(0)
    pipe.destroy()
  }
}

/** Only an inherited pipe is accepted. There is no ticket argument/env/file interface. */
export async function readVaultExecEnvelope(pipe: Readable): Promise<VaultExecEnvelope> {
  const bytes = await readPrivatePipe(pipe, VAULT_LIMITS.frameBytes)
  try {
    return vaultExecEnvelopeSchema.parse(JSON.parse(bytes.toString('utf8')))
  } catch {
    throw new Error(UI_TEXT.vault.noAccess)
  } finally {
    bytes.fill(0)
  }
}

/** W composes the executable with B's authenticated transport, T's scrubber and host containment. */
export async function vaultExecEntry(
  pipe: Readable,
  env: NodeJS.ProcessEnv,
  port: VaultExecFeederPort,
  signal: AbortSignal,
) {
  return await runVaultFeeder(await readVaultExecEnvelope(pipe), env, port, signal)
}

/** W's executable dispatches helper git/askpass here; only its private stdout receives bytes. */
export async function vaultExecHelperEntry(
  kind: 'git' | 'askpass',
  endpoint: string,
  operation: string | undefined,
  input: Readable,
  output: Writable,
  isServerAllowed: (socket: Socket) => Promise<boolean>,
): Promise<void> {
  let joined: Buffer | undefined
  let answer: Buffer | undefined
  try {
    if (kind === 'git') joined = await readPrivatePipe(input, VAULT_LIMITS.text)
    answer = await callVaultExecHelper(
      endpoint,
      kind === 'git' ? { kind, operation, input: joined?.toString('utf8') } : { kind },
      isServerAllowed,
    )
    const bytes = answer
    await new Promise<void>((resolve, reject) => {
      output.write(bytes, (error) => {
        if (error) reject(error)
        else resolve()
      })
    })
  } finally {
    joined?.fill(0)
    answer?.fill(0)
  }
}
