import { describe, expect, it } from 'vitest'
import { isPrivateFileName } from '../../src/shared/privateFiles'

// The shared private-file list (M54's attachment rule, shared since M70):
// attachments refuse these names (`attachmentRejected` in
// conversationController.ts) and the review leaves them out of its material
// (reviewMaterial.ts). M94 (PLAN.md D73, research L9/L25) widens the one list
// with the leaders' entries, tightening both callers at once.
describe('isPrivateFileName with the M94 secret-file entries (PLAN.md D73)', () => {
  it('refuses the five new entries as bare names and nested paths', () => {
    for (const name of [
      'server.crt',
      'server.cert',
      'server.keystore',
      'secrets.yml',
      '.dev.vars',
      'tls/server.CRT',
      'config/keystore/server.keystore',
      'config/secrets.yml',
      'config/.dev.vars',
      'Secrets.YML',
    ]) {
      expect(isPrivateFileName(name), name).toBe(true)
    }
  })

  it('still refuses the entries both callers already refused', () => {
    for (const name of [
      '.env',
      '.env.local',
      '.env.production',
      'credentials.json',
      'auth.json',
      'id_rsa',
      'id_ed25519',
      'server.key',
      'server.pem',
      'server.p12',
      'server.pfx',
      'keys/server.PEM',
    ]) {
      expect(isPrivateFileName(name), name).toBe(true)
    }
  })

  it('still allows ordinary files, including near misses', () => {
    for (const name of [
      'server.ts',
      'notes.yml',
      'secret.yml',
      'dev.vars',
      'mycrt.txt',
      'server.crt.bak',
      'cert',
      'keystore.json',
    ]) {
      expect(isPrivateFileName(name), name).toBe(false)
    }
  })
})
