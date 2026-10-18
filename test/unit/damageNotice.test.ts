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
      // A reader healthy before another window's damage still clears after
      // the repair, so the recurrence announces instead of meeting the
      // other window's stale marker.
      const windowC = new DamageNoter(fileDamageMarkers(file), (identity) => {
        announced.push(identity)
      })
      const windowD = new DamageNoter(fileDamageMarkers(file), (identity) => {
        announced.push(identity)
      })
      windowC.noteHealthy()
      windowD.noteDamaged('corrupt-c')
      expect(announced).toEqual(['corrupt-a', 'corrupt-a', 'corrupt-b', 'corrupt-a', 'corrupt-c'])
      windowC.noteHealthy()
      windowC.noteDamaged('corrupt-c')
      expect(announced).toEqual([
        'corrupt-a',
        'corrupt-a',
        'corrupt-b',
        'corrupt-a',
        'corrupt-c',
        'corrupt-c',
      ])
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
})
