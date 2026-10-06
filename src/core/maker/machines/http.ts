import type { MakerSecrets } from '../ports'
import { Buffer } from 'node:buffer'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { isIP } from 'node:net'
import * as z from 'zod/mini'
import { HTTP_SUCCESS_MIN, HTTP_SUCCESS_MAX } from '../../../shared/constants'
import { redactSecrets } from '../../../shared/redact'
import {
  MachineError,
  machineSecretName,
  machineRecordSchema,
  machineTarget,
  type MakerLanPolicy,
  type MachineRecord,
} from '../registry'

const responseBodySchema = z.union([z.record(z.string(), z.unknown()), z.null()])

export interface MachineHttpPolicy {
  readonly timeoutMs: number
  readonly maxResponseBytes: number
  /** Host-owned live admission after all preparation, before the synchronous write guard. */
  readonly beforeGuardedDispatch?: () => Promise<void>
  /** Host lifecycle observation after the final guard, before the synchronous request creation. */
  readonly onGuardedDispatch?: () => void
}
export interface HttpReply {
  readonly status: number
  readonly body: unknown
}

/** No redirects, proxy discovery, URL credentials, or second DNS lookup. */
export class MachineHttp {
  private readonly record: MachineRecord
  private address: string | undefined
  constructor(
    record: MachineRecord,
    private readonly lan: MakerLanPolicy,
    private readonly secrets: MakerSecrets,
    private readonly policy: MachineHttpPolicy,
  ) {
    this.record = machineRecordSchema.parse(record)
  }
  assertTarget(record: MachineRecord): void {
    if (
      record.id !== this.record.id ||
      record.endpoint !== this.record.endpoint ||
      record.kind !== this.record.kind ||
      record.registrationId !== this.record.registrationId
    )
      throw new MachineError('machineTargetMismatch')
  }
  async json(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<() => void>,
  ): Promise<unknown> {
    const reply = await this.request(method, path, body, signal, beforeWrite)
    return reply.body
  }
  async request(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
    beforeWrite?: () => Promise<() => void>,
  ): Promise<HttpReply> {
    if (
      !path.startsWith('/') ||
      path.startsWith('//') ||
      path.includes('#') ||
      /[\r\n]/.test(path)
    ) {
      throw new MachineError('machinePath')
    }
    const target = await machineTarget(this.record, this.lan)
    if (this.address !== undefined && target.address !== this.address)
      throw new MachineError('machineAddressChanged')
    this.address = target.address
    let key = await this.secrets.get(machineSecretName(this.record.registrationId))
    try {
      const payload = body === undefined ? undefined : JSON.stringify(body)
      const request = target.url.protocol === 'https:' ? httpsRequest : httpRequest
      const deadline = AbortSignal.timeout(this.policy.timeoutMs)
      const cancellation = signal === undefined ? deadline : AbortSignal.any([deadline, signal])
      const check = await beforeWrite?.()
      if (beforeWrite !== undefined) await this.policy.beforeGuardedDispatch?.()
      return await new Promise<HttpReply>((resolve, reject) => {
        // DNS, SecretStorage and the last status read have settled. Creating
        // a ClientRequest may already open a socket: guard before creation.
        cancellation.throwIfAborted()
        check?.()
        if (beforeWrite !== undefined) this.policy.onGuardedDispatch?.()
        const outgoing = request(
          {
            protocol: target.url.protocol,
            hostname: target.address,
            port: target.url.port,
            path,
            method,
            agent: false,
            signal: cancellation,
            ...(isIP(target.url.hostname.replaceAll(/^\[|\]$/g, '')) === 0 && {
              servername: target.url.hostname,
            }),
            headers: {
              host: target.url.host,
              accept: 'application/json',
              ...(key !== undefined && { 'X-Api-Key': key }),
              ...(payload !== undefined && {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(payload),
              }),
            },
          },
          (response) => {
            const chunks: Buffer[] = []
            let size = 0
            response.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > this.policy.maxResponseBytes) {
                response.destroy(new MachineError('machineResponseSize'))
                return
              }
              chunks.push(chunk)
            })
            response.on('error', () => {
              reject(new MachineError('machineTransport'))
            })
            response.on('end', () => {
              const status = response.statusCode ?? 0
              if (status < HTTP_SUCCESS_MIN || status > HTTP_SUCCESS_MAX) {
                reject(new MachineError('machineHttpStatus'))
                return
              }
              try {
                const text = redactSecrets(
                  Buffer.concat(chunks).toString('utf8'),
                  key === undefined ? [] : [key],
                )
                const parsed: unknown = text === '' ? null : JSON.parse(text)
                resolve({ status, body: responseBodySchema.parse(parsed) })
              } catch {
                reject(new MachineError('machineResponse'))
              }
            })
          },
        )
        outgoing.on('error', () => {
          reject(new MachineError('machineTransport'))
        })
        outgoing.end(payload)
      })
    } finally {
      key = undefined
    }
  }
}
