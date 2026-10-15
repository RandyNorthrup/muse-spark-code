import { createServer } from 'node:net'
import { expect, it } from 'vitest'
import { UI_TEXT } from '../../src/shared/constants'
import { companionMediaTransport } from '../../src/webview/media/transport'

it('reports a real refused upload connection with its cause, without completing progress', async () => {
  // Reserve then close an OS-assigned port. No service or provider answers it.
  const reservation = createServer()
  await new Promise<void>((resolve, reject) => {
    reservation.once('error', reject)
    reservation.listen(0, '127.0.0.1', resolve)
  })
  const address = reservation.address()
  await new Promise<void>((resolve, reject) => {
    reservation.close((error) => {
      if (error === undefined) resolve()
      else reject(error)
    })
  })
  if (address === null || typeof address === 'string') throw new Error('No reserved TCP port')
  const origin = `http://127.0.0.1:${String(address.port)}`
  const transport = companionMediaTransport(() => ({
    endpoint: `${origin}/media`,
    origin,
    bearer: 'synthetic-no-service-token',
    customHeader: { name: 'x-muse-guard', value: '1' },
    metadataHeader: 'x-muse-media',
  }))
  const progress: number[] = []
  await expect(
    transport.upload(
      new Blob(['clip']),
      'clip.mp4',
      false,
      new AbortController().signal,
      (uploaded) => {
        progress.push(uploaded)
      },
    ),
  ).rejects.toMatchObject({
    message: UI_TEXT.attachmentUnreadable,
    cause: { cause: { code: 'ECONNREFUSED' } },
  })
  expect(progress).toEqual([0])
})
