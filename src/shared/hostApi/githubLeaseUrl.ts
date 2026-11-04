// The pin on what `github/request` may reach (M123, PLAN.md D104 §2): GitHub's
// own API, its `/user` and `/repos/…` paths, with nothing of a credential in the
// address. A leaf, so the method's schema and the lease's `fetch` share one rule
// and the lease can refuse in words before the schema would refuse in its own.
import { GITHUB_API_BASE_URL } from '../constants'

export function isGitHubLeaseUrl(value: string): boolean {
  let url: URL
  try {
    url = new URL(value)
  } catch (error) {
    // A malformed request URL is invalid input. Anything else keeps its kind.
    if (error instanceof TypeError) return false
    throw error
  }
  return (
    url.origin === GITHUB_API_BASE_URL &&
    url.username === '' &&
    url.password === '' &&
    url.hash === '' &&
    (url.pathname === '/user' || url.pathname.startsWith('/repos/'))
  )
}
