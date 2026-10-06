import { CAPTURED_PULL_LIST, CAPTURED_CHECKS_FAILED } from '../githubCapture'

// Bodies reuse M71's actual 2026-09-28 capture. Rate-control headers below
// are synthetic faults using D93's named headers, not claimed live receipts.
export function reportingHttpFixtures(): {
  pulls: Response
  failingChecks: Response
  rateFloor: Response
  retry: Response
  notModified: Response
} {
  return {
    pulls: Response.json(CAPTURED_PULL_LIST),
    failingChecks: Response.json(CAPTURED_CHECKS_FAILED),
    rateFloor: Response.json(
      { message: 'Fixture rate limit' },
      {
        status: 403,
        headers: { 'x-ratelimit-remaining': '10', 'x-ratelimit-reset': '1791288000' },
      },
    ),
    retry: new Response(null, { status: 429, headers: { 'retry-after': '60' } }),
    notModified: new Response(null, { status: 304, headers: { etag: '"fixture-v1"' } }),
  }
}
