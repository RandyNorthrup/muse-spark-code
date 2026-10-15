import { mkdtempSync, rmSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { DamageNoter, fileDamageMarkers } from '../../src/runtime/damageNotice'

describe('durable damage announcements', () => {
  it('announces recurrence after another reader repairs the shared file', () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), 'muse-damage-'))
    try {
      const file = path.join(directory, 'choice.json')
      const announced: string[] = []
      const windowA = new DamageNoter(fileDamageMarkers(file), (identity) => {
        announced.push(identity)
      })
      const windowB = new DamageNoter(fileDamageMarkers(file), (identity) => {
        announced.push(identity)
      })
      windowA.noteDamaged('corrupt-a')
      windowA.noteDamaged('corrupt-a')
      windowB.noteDamaged('corrupt-a')
      expect(announced).toEqual(['corrupt-a'])
      windowB.noteHealthy()
      windowA.noteDamaged('corrupt-a')
      expect(announced).toEqual(['corrupt-a', 'corrupt-a'])
      windowB.noteDamaged('corrupt-b')
      windowA.noteDamaged('corrupt-a')
      expect(announced).toEqual(['corrupt-a', 'corrupt-a', 'corrupt-b', 'corrupt-a'])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
