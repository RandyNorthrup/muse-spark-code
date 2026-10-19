/** Authenticated browser transport; the launch page's private fetch closure owns the bearer. */
export async function companionPost(message: unknown, signal: AbortSignal): Promise<void> {
  const response = await window.fetch('/post', {
    method: 'POST',
    credentials: 'omit',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
    body: JSON.stringify(message),
  })
  if (!response.ok) throw new Error('EPANEL_POST')
}

export async function companionEvents(options: {
  readonly signal: AbortSignal
  readonly maxBytes: number
  readonly ready: () => void
  readonly event: (input: unknown) => Promise<void>
}): Promise<void> {
  const response = await window.fetch('/events', {
    method: 'POST',
    credentials: 'omit',
    signal: options.signal,
    headers: { 'Content-Type': 'application/json', 'X-Muse-Panel': '1' },
    body: '{}',
  })
  if (!response.ok || response.body === null) throw new Error('EPANEL_STREAM')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let pending = ''
  options.ready()
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) throw new Error('EPANEL_CLOSED')
      pending += decoder.decode(chunk.value, { stream: true })
      let boundary = pending.indexOf('\n\n')
      while (boundary !== -1) {
        const frame = pending.slice(0, boundary)
        pending = pending.slice(boundary + 2)
        if (frame.startsWith('data: ')) {
          const raw: unknown = JSON.parse(frame.slice('data: '.length))
          await options.event(raw)
        }
        boundary = pending.indexOf('\n\n')
      }
      if (pending.length > options.maxBytes) throw new Error('EPANEL_EVENT')
    }
  } finally {
    reader.releaseLock()
  }
}
