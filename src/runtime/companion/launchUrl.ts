import { UI_TEXT } from '../../shared/constants'

/**
Validate before handing a companion launch URL to an editor or an OS
opener. The companion server mints every launch URL in this shape: plain
HTTP on 127.0.0.1 with a port, no credentials, no query, and the
single-use code in the fragment.
*/
export function companionLaunchUrl(input: string): string {
  const url = new URL(input)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.port === '' ||
    url.username !== '' ||
    url.password !== '' ||
    url.pathname !== '/' ||
    url.search !== '' ||
    !/^#(?:k=)?[\da-f]{64}$/iu.test(url.hash)
  ) {
    throw new Error(UI_TEXT.actionFailed)
  }
  return url.href
}
