// A link to a web page in a list of them: a reply's sources (M33) or a
// search's results (M43). It opens like the reply's own links: http and https
// in the browser through the host, anything else refused.

import { linkLabel, linkTarget } from '../links'

export function ExternalLink({
  url,
  title,
  onOpenLink,
  onRefuseLink,
}: {
  readonly url: string
  readonly title: string | undefined
  readonly onOpenLink: (url: string) => void
  readonly onRefuseLink: (() => void) | undefined
}) {
  return (
    <a
      href={url}
      title={url}
      onClick={(event) => {
        event.preventDefault()
        const target = linkTarget(url)
        if (target.kind === 'external') {
          onOpenLink(target.url)
        } else {
          onRefuseLink?.()
        }
      }}
    >
      {linkLabel(title, url)}
    </a>
  )
}
