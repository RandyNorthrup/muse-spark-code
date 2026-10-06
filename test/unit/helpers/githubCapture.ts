// GitHub REST responses as github.com sent them on 2026-09-28 (M71 capture,
// `gh api -i`, API version 2022-11-28; docs/certification/m71.md). The
// tests build on these shapes, not on guesses (AGENTS.md rule 13). Each
// object keeps the fields the extension reads and a few it does not, so a
// parser that stops ignoring the rest would show it; URLs and ids are as
// captured. The 422 bodies came from two POSTs GitHub refused before
// creating anything (a head branch that does not exist, and a head that
// already has an open pull request).

const REPOSITORY = 'RandyNorthrup/muse-spark-code'
const OWNER_ID = 122_551_425

/** `GET /user` for the account the captures ran as. */
export const CAPTURED_USER = {
  login: 'RandyNorthrup',
  id: OWNER_ID,
  node_id: 'U_kgDOB038gQ',
  type: 'User',
  site_admin: false,
}

/** `GET /repos/RandyNorthrup/muse-spark-code`. */
export const CAPTURED_REPOSITORY = {
  id: 1_380_770_788,
  name: 'muse-spark-code',
  full_name: REPOSITORY,
  private: false,
  owner: { login: 'RandyNorthrup', id: OWNER_ID, type: 'User' },
  fork: false,
  default_branch: 'main',
  visibility: 'public',
  permissions: { admin: true, maintain: true, push: true, triage: true, pull: true },
}

/** `GET /repos/Piangpi1997/muse-spark-code`: a fork, naming its parent. */
export const CAPTURED_FORK_REPOSITORY = {
  id: 1_391_846_213,
  name: 'muse-spark-code',
  full_name: 'Piangpi1997/muse-spark-code',
  private: false,
  owner: { login: 'Piangpi1997', id: 203_822_472, type: 'User' },
  fork: true,
  default_branch: 'main',
  permissions: { admin: false, maintain: false, push: false, triage: false, pull: true },
  parent: {
    id: 1_380_770_788,
    full_name: REPOSITORY,
    fork: false,
    default_branch: 'main',
    owner: { login: 'RandyNorthrup', id: OWNER_ID, type: 'User' },
  },
  source: { id: 1_380_770_788, full_name: REPOSITORY, fork: false, default_branch: 'main' },
}

function userOf(login: string, id: number) {
  return { login, id, node_id: 'U_kgDO', type: 'User', site_admin: false }
}

/** `GET /repos/…/pulls/51`: open, by another account, from a fork. */
export const CAPTURED_PULL_FORK = {
  url: `https://api.github.com/repos/${REPOSITORY}/pulls/51`,
  id: 4_659_628_839,
  html_url: `https://github.com/${REPOSITORY}/pull/51`,
  number: 51,
  state: 'open',
  locked: false,
  title: 'test: lock Android/Termux P0 behavior for launch and voice',
  user: userOf('Piangpi1997', 203_822_472),
  body: '## What and why\r\n\r\nAdds regression coverage for Android/Termux behavior.',
  created_at: '2026-09-28T05:23:33Z',
  updated_at: '2026-09-28T05:23:34Z',
  closed_at: null,
  merged_at: null,
  draft: false,
  head: {
    label: 'Piangpi1997:android-termux-p0-tests',
    ref: 'android-termux-p0-tests',
    sha: '29fe2d8a111e5424c69c3ad0e7328b53a98646af',
    user: userOf('Piangpi1997', 203_822_472),
    repo: { id: 1_391_846_213, full_name: 'Piangpi1997/muse-spark-code', fork: true },
  },
  base: {
    label: 'RandyNorthrup:main',
    ref: 'main',
    sha: '72fa907d3d64fde7baf36cc873ac0c0816eb13cb',
    user: userOf('RandyNorthrup', OWNER_ID),
    repo: { id: 1_380_770_788, full_name: REPOSITORY, fork: false },
  },
  author_association: 'FIRST_TIME_CONTRIBUTOR',
  merged: false,
  mergeable: true,
  mergeable_state: 'behind',
}

/** `GET /repos/…/pulls/56`: open, by the capturing account, same repository. */
export const CAPTURED_PULL_OWN = {
  ...CAPTURED_PULL_FORK,
  url: `https://api.github.com/repos/${REPOSITORY}/pulls/56`,
  html_url: `https://github.com/${REPOSITORY}/pull/56`,
  number: 56,
  title: 'README: how this extension is built',
  user: userOf('RandyNorthrup', OWNER_ID),
  created_at: '2026-09-28T17:33:43Z',
  updated_at: '2026-09-28T18:33:05Z',
  author_association: 'OWNER',
  mergeable_state: 'blocked',
  head: {
    label: 'RandyNorthrup:docs/how-its-built',
    ref: 'docs/how-its-built',
    sha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
    user: userOf('RandyNorthrup', OWNER_ID),
    repo: { id: 1_380_770_788, full_name: REPOSITORY, fork: false },
  },
  base: {
    ...CAPTURED_PULL_FORK.base,
    sha: 'c42c4d5fd47297ce6c57e202e092d18b92206ed8',
  },
}

/** `GET /repos/…/pulls/49`: closed and merged. */
export const CAPTURED_PULL_MERGED = {
  ...CAPTURED_PULL_OWN,
  html_url: `https://github.com/${REPOSITORY}/pull/49`,
  number: 49,
  state: 'closed',
  title: "Read the Muse Code CLI's sign-in from its credential file, not its presence",
  closed_at: '2026-09-28T16:06:29Z',
  merged_at: '2026-09-28T16:06:29Z',
  merged: true,
  head: {
    ...CAPTURED_PULL_OWN.head,
    label: 'RandyNorthrup:fix/cli-sign-in-detection',
    ref: 'fix/cli-sign-in-detection',
    sha: '5184f26986283cfcacd64da8628c76a5e062a4ff',
  },
}

/**
 * `GET /repos/…/pulls?head=RandyNorthrup:docs/how-its-built&state=open`:
 * the list form, which has no `merged` field.
 */
export const CAPTURED_PULL_LIST = [
  (({ merged: _merged, mergeable: _mergeable, mergeable_state: _state, ...listed }) => listed)(
    CAPTURED_PULL_OWN,
  ),
]

function checkRun(id: number, name: string, status: string, conclusion: string | null) {
  const url = `https://github.com/${REPOSITORY}/actions/runs/36465729961/job/${String(id)}`
  return {
    id,
    name,
    head_sha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
    status,
    conclusion,
    html_url: url,
    details_url: url,
    started_at: '2026-09-28T18:30:57Z',
    app: { slug: 'github-actions' },
  }
}

/** `GET /repos/…/commits/e9ebe7a…/check-runs?per_page=100`: one running, five passed. */
export const CAPTURED_CHECKS_RUNNING = {
  total_count: 6,
  check_runs: [
    checkRun(109_075_387_274, 'build / quality (windows-latest)', 'in_progress', null),
    checkRun(109_075_387_214, 'build / dictation helper (macos)', 'completed', 'success'),
    checkRun(109_075_387_145, 'build / quality (macos-latest)', 'completed', 'success'),
    checkRun(109_075_387_144, 'build / semgrep', 'completed', 'success'),
    checkRun(109_075_386_874, 'build / quality (ubuntu-latest)', 'completed', 'success'),
    checkRun(109_075_386_488, 'build / gitleaks', 'completed', 'success'),
  ],
}

/** The same for 1ae3604f: one failed, one skipped. */
export const CAPTURED_CHECKS_FAILED = {
  total_count: 7,
  check_runs: [
    checkRun(1, 'build / package (.vsix)', 'completed', 'skipped'),
    checkRun(2, 'build / quality (macos-latest)', 'completed', 'failure'),
    checkRun(3, 'build / gitleaks', 'completed', 'success'),
    checkRun(4, 'build / semgrep', 'completed', 'success'),
    checkRun(5, 'build / quality (ubuntu-latest)', 'completed', 'success'),
    checkRun(6, 'build / quality (windows-latest)', 'completed', 'success'),
    checkRun(7, 'build / dictation helper (macos)', 'completed', 'success'),
  ],
}

/** The same for 19e74b07: a cancelled run. */
export const CAPTURED_CHECKS_CANCELLED = {
  total_count: 2,
  check_runs: [
    checkRun(8, 'build / quality (ubuntu-latest)', 'completed', 'cancelled'),
    checkRun(9, 'build / semgrep', 'completed', 'success'),
  ],
}

/** The fork pull request #51: its workflows waited for approval, so no runs. */
export const CAPTURED_CHECKS_NONE = { total_count: 0, check_runs: [] }

/** `GET /repos/…/commits/e9ebe7a…/status`: no statuses reads `pending` with a count of 0. */
export const CAPTURED_STATUS_NONE = {
  state: 'pending',
  statuses: [],
  sha: 'e9ebe7aad7ee658821d4a43a0bf967bbd87c9aa5',
  total_count: 0,
}

/** `GET /repos/microsoft/TypeScript/commits/df1a31e…/status`: statuses posted by other services. */
export const CAPTURED_STATUS_FAILED = {
  state: 'failure',
  sha: 'df1a31e6d5c4aa4485f276fdfb4218a7bfcdf348',
  total_count: 3,
  statuses: [
    {
      state: 'success',
      context: 'codecov/patch',
      description: 'Coverage not affected when comparing 55a46f1...df1a31e',
      target_url: 'https://app.codecov.io/gh/microsoft/TypeScript/commit/df1a31e',
    },
    {
      state: 'success',
      context: 'codecov/project',
      description: '88.23286% (+0.01818%) compared to 55a46f1',
      target_url: 'https://app.codecov.io/gh/microsoft/TypeScript/commit/df1a31e',
    },
    {
      state: 'failure',
      context: 'TypeScript Localization Update',
      description: '#20260924.2 failed',
      target_url: 'https://devdiv.visualstudio.com/_build/results?buildId=15440273',
    },
  ],
}

/** `GET /repos/…/pulls/999999`. */
export const CAPTURED_NOT_FOUND = {
  message: 'Not Found',
  documentation_url: 'https://docs.github.com/rest/pulls/pulls#get-a-pull-request',
  status: '404',
}

/** `POST /repos/…/pulls` with a head branch that does not exist. */
export const CAPTURED_INVALID_HEAD = {
  message: 'Validation Failed',
  errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }],
  documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
  status: '422',
}

/** `POST /repos/…/pulls` for a head that already has an open pull request. */
export const CAPTURED_ALREADY_EXISTS = {
  message: 'Validation Failed',
  errors: [
    {
      resource: 'PullRequest',
      code: 'custom',
      message: 'A pull request already exists for RandyNorthrup:docs/how-its-built.',
    },
  ],
  documentation_url: 'https://docs.github.com/rest/pulls/pulls#create-a-pull-request',
  status: '422',
}
