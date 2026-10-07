import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { execAttachmentBlocks, parseAttachArgs } from '../../src/runtime/exec/attachArgs'
import { parseCommandLine } from '../../src/runtime/cliArgs'
import { MAX_ATTACHMENTS_PER_MESSAGE, UI_TEXT } from '../../src/shared/constants'

const signal = new AbortController().signal
describe('exec --attach', () => {
  it('preserves repeated attachments and leaves no-attachment options unchanged', () => {
    const parsed = parseCommandLine(['exec', '--attach', 'clip.mp4', '--attach=voice.wav', 'task'])
    expect(parsed).toMatchObject({
      command: 'exec',
      options: { attachFiles: ['clip.mp4', 'voice.wav'] },
    })
    const plain = parseCommandLine(['exec', 'task'])
    expect(plain.command === 'exec' && 'attachFiles' in plain.options).toBe(false)
  })

  it('refuses blank, malformed, excess or missing attachment arguments and headless recording', () => {
    for (const value of [
      '',
      [''],
      [1],
      ['file\0name'],
      Array.from({ length: MAX_ATTACHMENTS_PER_MESSAGE + 1 }, () => 'clip.mp4'),
    ])
      expect(parseAttachArgs(value).ok).toBe(false)
    expect(parseCommandLine(['exec', '--attach'])).toMatchObject({
      command: 'invalid',
      exitCode: 2,
    })
    expect(parseCommandLine(['exec', '--record', 'task'])).toEqual({
      command: 'invalid',
      exitCode: 2,
      reason: UI_TEXT.media.recordingUserOnly,
    })
  })

  it('confines paths and symlinks before making any ACP link', async () => {
    for (const file of ['../private.mp4', '/outside/clip.mp4', 'link.mp4'])
      await expect(execAttachmentBlocks([file], '/ws', signal, 'linux', realPath)).rejects.toThrow(
        UI_TEXT.textFilePrivate,
      )
    expect(
      await execAttachmentBlocks(['dir/clip #1.mp4'], '/ws', signal, 'linux', realPath),
    ).toEqual([
      {
        type: 'resource_link',
        uri: pathToFileURL('/ws/dir/clip #1.mp4').href,
        name: 'clip #1.mp4',
      },
    ])
  })

  it('handles Windows separators and URI escaping without a platform-specific path assumption', async () => {
    const blocks = await execAttachmentBlocks(
      [String.raw`dir\clip #1.mp4`],
      String.raw`C:\ws`,
      signal,
      'win32',
      (given) => Promise.resolve(path.win32.normalize(given)),
    )
    expect(blocks).toEqual([
      { type: 'resource_link', uri: 'file:///C:/ws/dir/clip%20%231.mp4', name: 'clip #1.mp4' },
    ])
    await expect(
      execAttachmentBlocks(
        [String.raw`..\private.mp4`],
        String.raw`C:\ws`,
        signal,
        'win32',
        (given) => Promise.resolve(given),
      ),
    ).rejects.toThrow(UI_TEXT.textFilePrivate)
  })

  it('cancellation refuses before any path lookup', async () => {
    const controller = new AbortController()
    controller.abort()
    let calls = 0
    await expect(
      execAttachmentBlocks(['clip.mp4'], '/ws', controller.signal, 'linux', (given) => {
        calls++
        return Promise.resolve(given)
      }),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })
})

const realPath = (given: string) =>
  Promise.resolve(given.endsWith('link.mp4') ? '/outside/clip.mp4' : given)
