import process from 'node:process'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import type { UserPresence } from '../../core/maker/userPresence'
import { fill } from '../../shared/l10n/text'
import {
  MAKER_PRESENCE_ACTION,
  MAKER_PRESENCE_POLICY,
  MAKER_PRESENCE_POLICY_SHA256,
  MAKER_PRESENCE_TIMEOUT_MS,
  MAKER_PRESENCE_DIGEST_CHARS,
  MAKER_PRESENCE_START_FIELD,
  MAKER_PRESENCE_WRITABLE_MODE,
  MAKER_PRESENCE_CANCELLED_EXIT,
  UI_TEXT,
} from '../../shared/constants'

/** No guessed Darwin/Windows wire: M109 installs its signed helper through this same port. */
export function createUserPresence(platform: NodeJS.Platform, native?: UserPresence): UserPresence {
  if (native !== undefined) return native
  return {
    async check(request) {
      if (platform !== 'linux') return 'unavailable'
      try {
        const policy = await stat(MAKER_PRESENCE_POLICY)
        const binary = await stat('/usr/bin/pkcheck')
        if (
          policy.uid !== 0 ||
          binary.uid !== 0 ||
          (policy.mode & MAKER_PRESENCE_WRITABLE_MODE) !== 0 ||
          (binary.mode & MAKER_PRESENCE_WRITABLE_MODE) !== 0
        )
          return 'unavailable'
        // Exact shipped, root-owned policy: no auth_self_keep or implicit authorization.
        const uid = process.getuid?.()
        if (uid === undefined || uid === 0) return 'unavailable'
        const policyText = await readFile(MAKER_PRESENCE_POLICY, 'utf8')
        const installed = policyText.replace(
          `unix-user:${String(uid)}</annotate>`,
          'unix-user:@UID@</annotate>',
        )
        if (createHash('sha256').update(installed).digest('hex') !== MAKER_PRESENCE_POLICY_SHA256)
          return 'unavailable'
        const processStat = await readFile(`/proc/${String(process.pid)}/stat`, 'utf8')
        const start = processStat.slice(processStat.lastIndexOf(')') + 2).split(' ')[
          MAKER_PRESENCE_START_FIELD
        ]
        if (start === undefined || !/^\d+$/.test(start)) return 'unavailable'
        const reason = fill(UI_TEXT.makerPresenceReason, {
          machine: request.machine.replaceAll(/[\p{Cc}\p{Cf}]/gu, ''),
          action: request.summary,
          digest: request.digest.slice(0, MAKER_PRESENCE_DIGEST_CHARS),
        })
        return await new Promise((resolve) => {
          execFile(
            '/usr/bin/pkcheck',
            [
              '--action-id',
              MAKER_PRESENCE_ACTION,
              '--process',
              `${String(process.pid)},${start},${String(uid)}`,
              '--allow-user-interaction',
              '--detail',
              'polkit.message',
              reason,
              '--detail',
              'approval-id',
              request.id,
              '--detail',
              'payload-digest',
              request.digest,
            ],
            {
              // A fixed system-bus client needs no caller environment: in particular no LD_PRELOAD.
              env: {},
              timeout: MAKER_PRESENCE_TIMEOUT_MS,
              maxBuffer: 1,
              encoding: 'utf8',
            },
            (error) => {
              if (error === null) resolve('approved')
              else
                resolve(
                  error.code === 1 || error.code === MAKER_PRESENCE_CANCELLED_EXIT
                    ? 'denied'
                    : 'unavailable',
                )
            },
          )
        })
      } catch {
        return 'unavailable'
      }
    },
  }
}
