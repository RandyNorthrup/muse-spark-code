// D121: no import bound of ours on plugin files — the importer calls its
// reader with no byte bound, leaving the shared import reader's own bound
// to apply as for every other agent import. The real importer runs here
// over a real file on disk while the reader records the bound it was
// given: with the old plugin-only bound the reader saw 256 KiB, now it
// sees none.
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { pluginFolder, type PluginScanIo } from '../../src/core/import/pluginImport'

/** The scan's readers over the real filesystem, recording the bound given. */
function recordingIo(seen: { maxBytes: number | undefined }[]): PluginScanIo {
  return {
    list: (directory: string) =>
      Promise.resolve(
        readdirSync(directory, { withFileTypes: true }).map((entry) => ({
          name: entry.name,
          isDirectory: entry.isDirectory(),
        })),
      ),
    read: (file: string, maxBytes?: number) => {
      seen.push({ maxBytes })
      try {
        const text = readFileSync(file, 'utf8')
        return Promise.resolve(maxBytes === undefined || text.length <= maxBytes ? text : undefined)
      } catch {
        return Promise.resolve(undefined)
      }
    },
    isInOpenWorkspace: () => Promise.resolve(false),
    isWorkspaceTrusted: () => true,
    join: (...parts: string[]) => path.join(...parts),
    extensionOf: (name: string) => path.extname(name),
  }
}

function pluginFile(text: string): { dir: string; seen: { maxBytes: number | undefined }[] } {
  const dir = mkdtempSync(path.join(tmpdir(), 'm91b-import-'))
  writeFileSync(path.join(dir, 'guard.ts'), text)
  const seen: { maxBytes: number | undefined }[] = []
  return { dir, seen }
}

describe('plugin file import with no bound of ours', () => {
  it('reads the plugin file with no byte bound', async () => {
    const { dir, seen } = pluginFile(
      `export const Guard = async () => ({ "tool.execute.before": async () => {} })\n`,
    )
    const findings = await pluginFolder('opencode', 'user', dir, recordingIo(seen))
    expect(seen).toEqual([{ maxBytes: undefined }])
    const hooks = findings.filter((finding) => finding.kind === 'hook')
    expect(hooks).toHaveLength(1)
    expect(hooks[0]?.converted).toMatchObject({ ok: true })
  })
})
