import * as z from 'zod/mini'
import { VAULT_LIMITS } from '../../../shared/constants'
import { vaultCommandSchema, vaultTicketSchema, vaultUseSchema } from '../../../shared/vault'

const handle = z.string().check(z.regex(/^secret:\/\/[a-z][a-z0-9-]{0,47}$/u))
const text = z
  .string()
  .check(z.minLength(1), z.maxLength(VAULT_LIMITS.text), z.regex(/^[^\0\r\n]*$/u))
export const vaultShellSecretsSchema = z
  .strictObject({
    env: z.optional(z.record(z.string().check(z.regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)), handle)),
    stdin: z.optional(handle),
    totp: z.optional(handle),
    git: z.optional(
      z.strictObject({ handle, protocol: z.literal('https'), host: text, path: text }),
    ),
    sudo: z.optional(z.strictObject({ handle, path: text, askpass: z.optional(z.boolean()) })),
    ssh: z.optional(z.literal(true)),
  })
  .check(
    z.refine((v) => Object.keys(v.env ?? {}).length <= VAULT_LIMITS.names),
    z.refine((v) =>
      Object.keys(v.env ?? {}).every(
        (name) => !/^(?:SSH_AUTH_SOCK|SSH_AGENT_PID|GIT_.*|SSH_ASKPASS|SUDO_ASKPASS)$/iu.test(name),
      ),
    ),
    z.refine((v) => v.stdin === undefined || v.totp === undefined),
    z.refine((v) => !(v.sudo && !v.sudo.askpass && (v.stdin ?? v.totp))),
    z.refine(
      (v) =>
        Object.keys(v.env ?? {}).length > 0 ||
        v.stdin !== undefined ||
        v.totp !== undefined ||
        v.git !== undefined ||
        v.sudo !== undefined ||
        v.ssh === true,
    ),
  )
export type VaultShellSecrets = z.infer<typeof vaultShellSecretsSchema>
export const vaultRunSchema = z.strictObject({
  command: vaultCommandSchema,
  secrets: vaultShellSecretsSchema,
})
export type VaultRun = z.infer<typeof vaultRunSchema>
export const vaultExecEnvelopeSchema = z.strictObject({
  run: vaultRunSchema,
  approvals: z
    .array(z.strictObject({ ticket: vaultTicketSchema, use: vaultUseSchema }))
    .check(z.maxLength(VAULT_LIMITS.names)),
})
export type VaultExecEnvelope = z.infer<typeof vaultExecEnvelopeSchema>

/** No process-provenance claims from a pipe can prove local workspace shutdown. */
export const vaultExecResultSchema = z.strictObject({
  stdout: z.string().check(z.maxLength(VAULT_LIMITS.frameBytes)),
  stderr: z.string().check(z.maxLength(VAULT_LIMITS.frameBytes)),
  exitCode: z.nullable(z.number().check(z.int())),
  isTimedOut: z.boolean(),
  isCancelled: z.boolean(),
  isOutputTooLarge: z.optional(z.boolean()),
})
