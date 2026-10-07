import { createHash } from 'node:crypto'
import { VAULT_LIMITS } from '../../../shared/constants'
import { vaultUseSchema, vaultItemMetadataSchema, type VaultUse } from '../../../shared/vault'
import {
  SSH,
  SshReader,
  SshFramer,
  parseSshRequest,
  sshString,
  sshFrame,
  sshFailure,
  uint32,
} from './wire'
import { sshFingerprint, isSshSignatureValid, validateSignFlags, parsePublicKey } from './keys'
import { resolveKnownHost } from './knownHosts'
import { type SshSessionDeps, type SshIdentity } from './ports'

interface Binding {
  frame: Buffer
  hostKey: Buffer
  session: Buffer
  forwarding: boolean
}
/** One serialized owner per connection. Close is a synchronous generation barrier. */
export class VaultSshSession {
  private readonly framer = new SshFramer()
  private readonly controller = new AbortController()
  private readonly bindings: Binding[] = []
  private readonly ownedFrames = new Set<Buffer>()
  private queue = Promise.resolve()
  private queuedBytes = 0
  private generation = 0
  private isClosed = false
  private hasTerminated = false
  private unsubscribe: (() => void) | null = null
  constructor(private readonly deps: SshSessionDeps) {
    const unsubscribe = deps.access.subscribeInvalidation(() => {
      this.revoke()
    })
    if (this.isClosed) unsubscribe()
    else this.unsubscribe = unsubscribe
  }
  /**
   * Revocation ends the pinned client, not just this connection (D89.11).
   * B also calls the per-signature lifetime's terminate for an in-flight
   * admission; the once-guard keeps the two paths to a single kill.
   */
  private revoke(): void {
    void this.terminateClient()
    this.close()
  }
  private terminateClient(): Promise<boolean> {
    if (this.hasTerminated) return Promise.resolve(false)
    this.hasTerminated = true
    return this.deps.terminate()
  }
  private isCurrent(generation: number): boolean {
    return !this.isClosed && generation === this.generation
  }
  private check(generation: number): void {
    if (!this.isCurrent(generation)) throw sshFailure()
  }
  private async identities(generation: number): Promise<readonly SshIdentity[]> {
    const identities = await this.deps.access.identities(this.controller.signal)
    this.check(generation)
    if (identities.length > VAULT_LIMITS.items) throw sshFailure()
    return identities
      .map((identity) => ({
        ...identity,
        blob: Buffer.from(identity.blob),
        item: vaultItemMetadataSchema.parse(identity.item),
      }))
      .filter((identity) => {
        const item = vaultItemMetadataSchema.parse(identity.item)
        if (
          item.kind !== 'sshKey' ||
          item.hidden ||
          item.firstParty ||
          item.policy.mode === 'never'
        )
          return false
        const algorithm = parsePublicKey(identity.blob).algorithm
        if (
          item.fingerprint !== sshFingerprint(identity.blob) ||
          item.publicKey !== `${algorithm} ${identity.blob.toString('base64')}`
        )
          throw sshFailure()
        return true
      })
  }
  private async dispatch(frame: Buffer, generation: number): Promise<void> {
    const request = parseSshRequest(frame)
    switch (request.kind) {
      case 'unsupported': {
        this.deps.send(sshFrame(SSH.failure))
        return
      }
      case 'query': {
        // RFC 9987 §5.8.1: the query answer is message 29 carrying the query
        // name followed by the supported extension names, never message 6.
        this.deps.send(
          sshFrame(
            SSH.extensionResponse,
            Buffer.concat([sshString('query'), sshString('session-bind@openssh.com')]),
          ),
        )
        return
      }
      case 'identities': {
        const identities = await this.identities(generation)
        this.deps.send(
          sshFrame(
            SSH.identitiesAnswer,
            Buffer.concat([
              uint32(identities.length),
              ...identities.flatMap((identity) => [
                sshString(identity.blob),
                sshString(identity.item.label),
              ]),
            ]),
          ),
        )
        return
      }
      case 'bind': {
        if (
          this.bindings.length >= VAULT_LIMITS.names ||
          this.bindings.some(
            (binding) => !binding.forwarding || binding.session.equals(request.session),
          ) ||
          request.session.length === 0 ||
          request.session.length > VAULT_LIMITS.text ||
          !isSshSignatureValid(request.hostKey, request.session, request.signature)
        )
          throw sshFailure()
        resolveKnownHost(
          await this.deps.knownHosts.read(),
          request.hostKey,
          request.forwarding ? undefined : this.deps.destination,
        )
        this.check(generation)
        this.bindings.push({
          frame: sshFrame(SSH.extension, frame.subarray(1)),
          hostKey: Buffer.from(request.hostKey),
          session: Buffer.from(request.session),
          forwarding: request.forwarding,
        })
        this.deps.send(sshFrame(SSH.success))
        return
      }
      case 'sign': {
        const method = validateSignFlags(request.key, request.flags)
        const identities = await this.identities(generation),
          identity = identities.find((candidate) => candidate.blob.equals(request.key))
        if (!identity) throw sshFailure()
        const resolved = await this.resolveUse(request.data, identity, method, generation)
        const use = resolved.use
        this.check(generation)
        const ticket = await this.deps.access.authorize(identity, use, this.controller.signal)
        this.check(generation)
        // known_hosts may have rotated while the approval was pending: the
        // post-approval host must equal the approved one, same binding.
        if (resolved.use.kind === 'ssh' && resolved.binding !== undefined) {
          if (!this.bindings.includes(resolved.binding)) throw sshFailure()
          const fresh = resolveKnownHost(
            await this.deps.knownHosts.read(),
            resolved.binding.hostKey,
            this.deps.destination,
          )
          this.check(generation)
          if (fresh !== resolved.use.host) throw sshFailure()
        }
        this.check(generation)
        const lifetime = {
          close: () => {
            // B releases the admission after every signature; the reusable
            // agent connection survives. Revocation terminates the pinned
            // client through terminate and invalidation, never through here.
          },
          terminate: () => this.terminateClient(),
        }
        await this.deps.access.sign(
          identity,
          ticket,
          use,
          request.data,
          request.flags,
          lifetime,
          this.controller.signal,
          (signature) => {
            this.check(generation)
            if (!isSshSignatureValid(identity.blob, request.data, signature, method))
              throw sshFailure()
            this.deps.send(sshFrame(SSH.signAnswer, sshString(signature)))
          },
          this.bindings.map((binding) => binding.frame),
        )
      }
    }
  }
  private async resolveUse(
    data: Buffer,
    identity: SshIdentity,
    method: string,
    generation: number,
  ): Promise<{ readonly use: VaultUse; readonly binding: Binding | undefined }> {
    const reader = new SshReader(data)
    if (data.subarray(0, Buffer.byteLength('SSHSIG')).toString() === 'SSHSIG') {
      if (this.bindings.length > 0) throw sshFailure()
      reader.take(Buffer.byteLength('SSHSIG'))
      if (reader.text() !== 'git' || reader.string().length > 0) throw sshFailure()
      const hash = reader.text(),
        digest = reader.string()
      reader.end()
      if (
        (hash !== 'sha256' && hash !== 'sha512') ||
        digest.length !== (hash === 'sha256' ? VAULT_LIMITS.sha256Hex / 2 : VAULT_LIMITS.sha256Hex)
      )
        throw sshFailure()
      return {
        use: vaultUseSchema.parse({
          kind: 'sshSign',
          namespace: 'git',
          keyFingerprint: identity.item.fingerprint,
          dataDigest: createHash('sha256').update(data).digest('hex'),
        }),
        binding: undefined,
      }
    }
    const session = reader.string()
    if (reader.byte() !== SSH.userauth) throw sshFailure()
    const remoteUser = reader.text()
    if (!remoteUser || reader.text() !== 'ssh-connection') throw sshFailure()
    const authentication = reader.text()
    if (
      !['publickey', 'publickey-hostbound-v00@openssh.com'].includes(authentication) ||
      !reader.boolean() ||
      reader.text() !== method ||
      !reader.string().equals(identity.blob)
    )
      throw sshFailure()
    const binding = this.bindings.at(-1)
    if (
      authentication === 'publickey-hostbound-v00@openssh.com' &&
      (!binding || !reader.string().equals(binding.hostKey))
    )
      throw sshFailure()
    reader.end()
    if (binding && (binding.forwarding || !binding.session.equals(session))) throw sshFailure()
    const host = binding
      ? resolveKnownHost(await this.deps.knownHosts.read(), binding.hostKey, this.deps.destination)
      : 'unproven'
    this.check(generation)
    return {
      use: vaultUseSchema.parse({
        kind: 'ssh',
        host,
        remoteUser,
        hostKeyFingerprint: binding ? sshFingerprint(binding.hostKey) : null,
        sessionId: binding ? session.toString('base64') : null,
        forwarding: this.bindings.some((candidate) => candidate.forwarding),
      }),
      binding,
    }
  }
  receive(bytes: Uint8Array): void {
    if (this.isClosed) return
    try {
      this.framer.push(bytes, (frame) => {
        if (this.queuedBytes + frame.length > VAULT_LIMITS.frameBytes) throw sshFailure()
        const owned = Buffer.alloc(frame.length)
        frame.copy(owned)
        this.ownedFrames.add(owned)
        this.queuedBytes += owned.length
        const generation = this.generation
        const previous = this.queue
        this.queue = (async () => {
          try {
            await previous
            this.check(generation)
            await this.dispatch(owned, generation)
          } catch {
            try {
              if (this.isCurrent(generation)) this.deps.send(sshFrame(SSH.failure))
            } catch {
              this.close()
            }
          } finally {
            this.queuedBytes -= owned.length
            this.ownedFrames.delete(owned)
            owned.fill(0)
          }
        })()
      })
    } catch {
      this.close()
    }
  }
  async drained(): Promise<void> {
    await this.queue
  }
  close(): void {
    if (this.isClosed) return
    this.isClosed = true
    this.generation++
    this.controller.abort()
    for (const owned of this.ownedFrames) owned.fill(0)
    this.framer.close()
    for (const binding of this.bindings) {
      binding.frame.fill(0)
      binding.hostKey.fill(0)
      binding.session.fill(0)
    }
    this.bindings.length = 0
    try {
      this.unsubscribe?.()
    } finally {
      this.deps.close()
    }
  }
}
