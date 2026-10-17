// The M105 capture files are scrubbed research records: every private id must
// be a bare labelled placeholder. Lane MONEY017E found 16 response item ids
// that kept four original UUID groups after a placeholder prefix; this suite
// re-runs that rescan so a future capture cannot reintroduce one of them.

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const CAPTURES = fileURLToPath(new URL('../../docs/research/m105-captures/', import.meta.url))

function captureFiles(): { name: string; text: string }[] {
  return readdirSync(CAPTURES)
    .filter((name) => !name.startsWith('.'))
    .toSorted((a, b) => a.localeCompare(b))
    .map((name) => ({ name, text: readFileSync(path.join(CAPTURES, name), 'utf8') }))
}

/**
 * The scrub's own placeholders (`<file-id-12>`, `<home>`, …) are not raw ids,
 * so they are stripped before every pattern runs.
 */
function stripped(text: string): string {
  return text.replaceAll(/<[^<>\n]{1,80}>/g, '')
}

const PATTERNS = {
  // A complete UUID, or the trailing-four-groups shape the MONEY017E finding left.
  'full UUID': /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  'partial UUID': /-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/,
  'raw file-/msg_/resp_/req_ id':
    /(?:\bfile-[A-Za-z0-9][A-Za-z0-9_-]{3,}|\b(?:msg|resp|req)_[A-Za-z0-9]{4,})/,
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  // Windows (`C:\Users\…`) and POSIX (`/Users/…`, `/home/…`) user paths.
  'absolute user path': /(?:[A-Za-z]:\\Users\\[^"\s]*|\/Users\/[^"\s]*|\/home\/[^"\s<]*)/,
} as const

/** Benign public hex that is not identifier material: synthetic fixture hashes. */
function withoutFixtureHashes(text: string): string {
  return text.replaceAll(/"sha256":"[0-9a-f]{64}"/g, '"sha256":"<fixture-sha>"')
}

/**
 * Benign public hex that is not identifier material: the U16 record names the
 * public CLI build in its user agent and the public protocol schema
 * fingerprint. Both identify released software, not an account or a call.
 */
function withoutPublicBuildMetadata(text: string): string {
  return text
    .replaceAll(/"userAgent":"[^"]*"/g, '"userAgent":"<user-agent>"')
    .replaceAll(/"fingerprint":"sha256:[0-9a-f]{64}"/g, '"fingerprint":"<fingerprint>"')
}

describe('m105 capture scrub', () => {
  it('keeps no UUID or partial-UUID material in any capture file', () => {
    for (const { name, text } of captureFiles()) {
      const body = stripped(text)
      expect(body, `${name}: full UUID`).not.toMatch(PATTERNS['full UUID'])
      expect(body, `${name}: partial UUID`).not.toMatch(PATTERNS['partial UUID'])
    }
  })

  it('keeps no raw file-/msg_/resp_/req_ ids, emails or user paths', () => {
    for (const { name, text } of captureFiles()) {
      const body = stripped(text)
      for (const key of ['raw file-/msg_/resp_/req_ id', 'email', 'absolute user path'] as const) {
        expect(body, `${name}: ${key}`).not.toMatch(PATTERNS[key])
      }
    }
  })

  it('keeps no long hex run outside fixture hashes and public build metadata', () => {
    for (const { name, text } of captureFiles()) {
      const body = withoutPublicBuildMetadata(withoutFixtureHashes(stripped(text)))
      expect(body, `${name}: long hex run`).not.toMatch(/[0-9a-f]{24,}/)
    }
  })

  it('replaced each of the 16 leaky round-1 item ids with a bare placeholder', () => {
    const round1 = readFileSync(path.join(CAPTURES, 'round1-2026-10-05.jsonl'), 'utf8')
    for (let n = 8; n <= 23; n += 1) {
      const label = `<msg-id-${String(n)}>`
      const occurrences = round1.split(`"id":"${label}"`).length - 1
      expect(occurrences, label).toBe(1)
    }
  })
})
