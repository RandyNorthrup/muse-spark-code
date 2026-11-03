// M80 A21: scan-secrets counts secrets, prints the count, and nothing else.
//
// Deleted titles (docs/real-life/unproven.md):
// - test/unit/scanSecrets.test.ts, the whole file (`M80 scanner (A21) >
//   counts without excerpts`, refuses a missing file with 2 and no content)
// - test/unit/redact.test.ts, `redactSecrets > redacts the GitHub token %j
//   (M71)` (the planted shape this scenario counts)
// - test/unit/redact.test.ts, `M80 countSecretMatches (A19/A21) > uses
//   literal-first coverage and counts overlapping patterns only once`
//
// The planted token is synthetic and ours (`ghp_` plus random alphanumerics);
// it lives only in this cell's workspace, is never printed by the scenario,
// and the count output must not carry it either.
//
// Expected model attempts: 3. Dollar cap: $0.05.
import { randomBytes } from 'node:crypto'

const CLEAN = 'real-life-clean.txt'
const SECRET = 'real-life-secret.txt'
// Exit 10 is EXEC_SCAN_EXIT_FOUND, exit 2 a usage refusal.
const FOUND = 10

export default {
  title: 'scan-secrets counts a planted token and prints only the count',
  exec: {
    claims: ['ref/cli/scan-secrets/scan-secrets', 'ref/feature/secret-scan'],
    requests: 3,
    maxUsd: '0.05',
    async run(person, see) {
      const cleanMarker = person.marker()
      const secretMarker = person.marker()
      // Hex only: base64url's `-` and `_` would break the token's shape.
      const token = `ghp_${randomBytes(18).toString('hex')}`
      const staged = await person.exec(
        `Write two files in the workspace with your file tool, then reply with the one word DONE. ` +
          `The file ${CLEAN} holds the single line ${cleanMarker}. ` +
          `The file ${SECRET} holds two lines: ${secretMarker}, then ${token}. ` +
          `Write them exactly; do not explain.`,
        { mode: 'acceptEdits', maxRequests: 3 },
      )
      see('the staging turn completed', staged.code === 0, `exit ${String(staged.code)}`)
      see(
        'both files are on disk',
        person.file(CLEAN)?.includes(cleanMarker) === true &&
          person.file(SECRET)?.includes(secretMarker) === true,
        `${CLEAN}: ${person.file(CLEAN) ?? 'missing'}; ${SECRET}: ${person.file(SECRET) === undefined ? 'missing' : 'present'}`,
      )
      const clean = await person.command(['scan-secrets', CLEAN])
      see('a clean file scans with exit code 0', clean.code === 0, `exit ${String(clean.code)}`)
      see('a clean file counts zero', clean.stdout.trim() === '0', clean.stdout.trim() || '(empty)')
      see(
        'the count carries no excerpt of the file',
        !clean.stdout.includes(cleanMarker),
        clean.stdout.trim() || '(empty)',
      )
      const found = await person.command(['scan-secrets', SECRET])
      see(
        `the planted token scans with exit code ${String(FOUND)}`,
        found.code === FOUND,
        `exit ${String(found.code)}`,
      )
      see('the planted token counts one', found.stdout.trim() === '1', found.stdout.trim())
      see(
        'the count carries neither the token nor its neighbours',
        !found.stdout.includes(token) && !found.stdout.includes(secretMarker),
        found.stdout.trim(),
      )
      const missing = await person.command(['scan-secrets', 'no-such-file-real-life.txt'])
      see(
        'a missing file is refused with exit code 2',
        missing.code === 2,
        `exit ${String(missing.code)}`,
      )
      see('the refusal prints no file content', missing.stdout === '', missing.stdout)
    },
  },
}
