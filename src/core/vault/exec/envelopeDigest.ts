import { createHash } from 'node:crypto'
import { vaultExecEnvelopeSchema, type VaultExecEnvelope } from './schema'

/**
D243: the command envelope digest a delegation binds. Both sides digest
the schema-parsed envelope's canonical fields in a fixed order (env
names sorted), so key order in any one JSON text cannot split them.
Ticket digests already bind each approval's full use.
*/
export function vaultExecEnvelopeDigest(input: VaultExecEnvelope): string {
  const envelope = vaultExecEnvelopeSchema.parse(input)
  const { command, secrets } = envelope.run
  const canonical = [
    [command.executable, command.argv, command.cwd],
    [
      Object.entries(secrets.env ?? {}).toSorted(([a], [b]) => a.localeCompare(b)),
      secrets.stdin ?? null,
      secrets.totp ?? null,
      secrets.git ?? null,
      secrets.sudo ?? null,
      secrets.ssh ?? null,
    ],
    envelope.approvals.map(({ ticket, use }) => [ticket.id, ticket.digest, use.kind]),
  ]
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex')
}
