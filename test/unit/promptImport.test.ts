import { describe, expect, it, vi } from 'vitest'
import { PromptImporter, PromptSharer } from '../../src/core/prompts/promptImport'
import { parsePromptFile, serialisePromptFile } from '../../src/shared/prompts'
import { savedPromptFixture as fixture } from './helpers/sharingFixtures'

function importRig() {
  const read = vi.fn(() => Promise.resolve(serialisePromptFile(fixture)))
  const port = { read, isConfidentialWorkspace: () => false }
  return { read, importer: new PromptImporter(port) }
}

describe('prompt import', () => {
  it('previews all text/variables, imports untrusted, and never resolves or runs anything', async () => {
    const { importer, read } = importRig()
    expect(read).not.toHaveBeenCalled()
    const preview = await importer.preview(
      { kind: 'file', location: 'sample.muse-prompt.md' },
      'workspace',
    )
    expect(preview.prompt.body).toBe(fixture.body)
    expect(preview.variables).toEqual(fixture.variables)
    expect(preview.prompt.untrusted).toBe(true)
    preview.prompt.body = 'mutated'
    preview.prompt.untrusted = false
    expect(importer.accept(preview.id)).toEqual({ ...fixture, scope: 'workspace', untrusted: true })
    expect(() => importer.accept(preview.id)).toThrow()
  })
  it('rejects stale/cancelled previews and isolates returned preview mutations', async () => {
    const { importer } = importRig()
    const first = await importer.preview(
      { kind: 'link', location: 'https://example.org/prompt' },
      'user',
    )
    const second = await importer.preview(
      { kind: 'gist', location: 'https://gist.githubusercontent.com/raw' },
      'user',
    )
    expect(() => importer.accept(first.id)).toThrow()
    importer.cancel()
    expect(() => importer.accept(second.id)).toThrow()
  })
  it('fences overlapping and cancelled reads before a stale preview can be accepted', async () => {
    const { importer } = importRig()
    const source = { kind: 'link', location: 'https://example.org/p.muse-prompt.md' }
    const older = importer.preview(source, 'user')
    const stale = expect(older).rejects.toThrow()
    const current = await importer.preview(source, 'user')
    await stale
    expect(importer.accept(current.id).untrusted).toBe(true)
    const pending = importer.preview(source, 'user')
    const cancelled = expect(pending).rejects.toThrow()
    importer.cancel()
    await cancelled
  })
  it('enforces the byte cap even on otherwise valid portable files', async () => {
    const file = serialisePromptFile({ ...fixture, tags: ['x'.repeat(131_073)] })
    const read = () => Promise.resolve(file)
    await expect(
      new PromptImporter({ read, isConfidentialWorkspace: () => false }).preview(
        { kind: 'file', location: 'p.md' },
        'user',
      ),
    ).rejects.toThrow()
  })
  it('refuses malformed/oversized inputs and remote import in a confidential workspace', async () => {
    const read = vi.fn(() => Promise.resolve('x'.repeat(131_073)))
    await expect(
      new PromptImporter({ read, isConfidentialWorkspace: () => false }).preview(
        { kind: 'file', location: 'p.md' },
        'user',
      ),
    ).rejects.toThrow()
    read.mockClear()
    await expect(
      new PromptImporter({ read, isConfidentialWorkspace: () => true }).preview(
        { kind: 'link', location: 'https://example.org' },
        'user',
      ),
    ).rejects.toThrow()
    expect(read).not.toHaveBeenCalled()
    await expect(
      new PromptImporter({ read, isConfidentialWorkspace: () => false }).preview(
        { kind: 'bad', location: 'x' },
        'user',
      ),
    ).rejects.toThrow()
  })
})

function shareRig() {
  let confidential: boolean | undefined = false
  let secret = 'registered-sentinel'
  const release = vi.fn((_destination: 'copy' | 'file', _text: string, _title: string) =>
    Promise.resolve(),
  )
  const port = {
    release,
    isConfidentialWorkspace: () => confidential,
    redactRegisteredSecrets: (text: string) => text.replaceAll(secret, '[redacted]'),
    normalisePaths: (text: string) => text.replaceAll('/home/private', '[home]'),
  }
  return {
    release,
    sharer: new PromptSharer(port),
    confidential: (value: boolean | undefined) => {
      confidential = value
    },
    secret: (value: string) => {
      secret = value
    },
  }
}
describe('prompt sharing', () => {
  it('scrubs preview and exports valid portable Markdown only on the final click', async () => {
    const { sharer, release } = shareRig()
    const input = { ...fixture, body: 'registered-sentinel /home/private', variables: [] }
    const preview = sharer.preview(input, 'file', 'file')
    expect(release).not.toHaveBeenCalled()
    expect(parsePromptFile(preview.text).body).toBe('[redacted] [home]')
    await sharer.confirm(preview.id)
    expect(release).toHaveBeenCalledWith('file', preview.text, preview.title)
    await expect(sharer.confirm(preview.id)).rejects.toThrow()
    expect(sharer.preview(input, 'text', 'copy').text).toBe('[redacted] [home]')
    expect(sharer.preview(input, 'md', 'copy').text).toContain('# Review a selection\n')
  })
  it('keeps ordinary export bytes deterministic and round trips without losing metadata', () => {
    const { sharer } = shareRig()
    const first = sharer.preview(fixture, 'file', 'file')
    const second = sharer.preview(fixture, 'file', 'file')
    expect(first.text).toBe(second.text)
    expect(parsePromptFile(first.text)).toEqual(fixture)
  })
  it('refuses stale previews, cancellation, changed secrets and changed/unknown policy', async () => {
    const rig = shareRig()
    const first = rig.sharer.preview(fixture, 'text', 'copy')
    const next = rig.sharer.preview(fixture, 'text', 'copy')
    await expect(rig.sharer.confirm(first.id)).rejects.toThrow()
    rig.confidential(true)
    await expect(rig.sharer.confirm(next.id)).rejects.toThrow()
    expect(() => rig.sharer.preview(fixture, 'text', 'copy')).toThrow()
    rig.confidential(undefined)
    expect(() => rig.sharer.preview(fixture, 'text', 'copy')).toThrow()
    rig.confidential(false)
    const changed = rig.sharer.preview(fixture, 'text', 'copy')
    rig.secret('Review')
    await expect(rig.sharer.confirm(changed.id)).rejects.toThrow()
    const cancelled = rig.sharer.preview(fixture, 'text', 'copy')
    rig.sharer.cancel()
    await expect(rig.sharer.confirm(cancelled.id)).rejects.toThrow()
    expect(rig.release).not.toHaveBeenCalled()
  })
})
