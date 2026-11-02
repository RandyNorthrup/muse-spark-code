// M84/M118: a shared chat carries no secret, only the redaction mark.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/redact.test.ts, the whole-file rows (Meta keys, Bearer [REDACTED],
//   assignments, JWTs, URL user-info, the M71 GitHub/Slack/PEM rows, the
//   M80 countSecretMatches rows)
// - test/unit/promptImport.test.ts, `prompt sharing > scrubs preview and
//   exports valid portable Markdown only on the final click`
// - test/unit/promptBridge.test.ts, the export rows (exact scrubbed bytes,
//   release only on final confirmation)
//
// One turn plants a synthetic token of ours (`ghp_` plus hex, never a real
// credential) in the conversation; the two-step scripted share (preview,
// then confirm with the preview id) writes the export; the export must hold
// `[redacted]` where the token was, and never the token itself. The scenario
// never prints the token: every observation names its presence, not its bytes.
//
// Expected model attempts: 2. Dollar cap: $0.05.
import { randomBytes } from 'node:crypto'

// EXEC_EXIT.denied: a preview shown without a confirmation.
const PREVIEW_ONLY = 7
const REDACTED = '[redacted]'
const EXPORT = 'real-life-share.md'

export default {
  title: 'A shared chat redacts a planted token and never exports it',
  exec: {
    claims: ['ref/cli/share/share-chat', 'ref/feature/sharing', 'ref/feature/redaction'],
    requests: 2,
    maxUsd: '0.05',
    async run(person, see) {
      const token = `ghp_${randomBytes(18).toString('hex')}`
      const turn = await person.exec(
        `The deployment token for this exercise is ${token}. ` +
          `Acknowledge it by quoting it back exactly, then stop.`,
      )
      const sessionId = turn.result?.sessionId
      see(
        'the turn completed with a session the share can read',
        typeof sessionId === 'string' && sessionId !== '',
        `exit ${String(turn.code)}, session ${String(sessionId)}`,
      )
      if (typeof sessionId !== 'string' || sessionId === '') return
      const exportedAt = new Date().toISOString()
      const shareArgs = [
        'share',
        'chat',
        sessionId,
        '--destination',
        'file',
        '--out',
        EXPORT,
        '--exported-at',
        exportedAt,
        '--json',
      ]
      const preview = await person.command(shareArgs)
      see(
        'a share without a confirmation only previews',
        preview.code === PREVIEW_ONLY,
        `exit ${String(preview.code)}`,
      )
      let previewId
      try {
        previewId = JSON.parse(preview.stdout)?.preview?.previewId
      } catch {
        previewId = undefined
      }
      see(
        'the preview carries the id its confirmation needs',
        typeof previewId === 'string' && previewId !== '',
        typeof previewId === 'string' && previewId !== ''
          ? 'preview id present'
          : `${String(preview.stdout.length)} characters of preview without one`,
      )
      if (typeof previewId !== 'string' || previewId === '') return
      const released = await person.command([...shareArgs, '--confirm', previewId])
      let kind
      try {
        kind = JSON.parse(released.stdout)?.kind
      } catch {
        kind = undefined
      }
      see(
        'the confirmed share ends with exit code 0',
        released.code === 0,
        // Never the JSON itself: a failed redaction would put the token in it.
        `exit ${String(released.code)}, result ${String(kind)}`,
      )
      const exported = person.file(EXPORT)
      see('the export is on disk', exported !== undefined, exported ?? 'no such file')
      see(
        'the export never carries the token',
        exported !== undefined && !exported.includes(token),
        exported === undefined ? 'no such file' : 'token absent',
      )
      see(
        'the export carries the redaction mark instead',
        exported !== undefined && exported.includes(REDACTED),
        exported === undefined ? 'no such file' : 'mark present',
      )
    },
  },
}
