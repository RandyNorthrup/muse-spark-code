# 0.10.0: multi-IDE Preview and shared Stop/lifetime fixes

## Release candidate

Prepared 2026-09-30 on the PR55 integration candidate, based on main
`327094412dac315b1f8dcf971b014c6c69b27104`. The owner authorized release
after the shared Stop/lifetime fixes land, and made publishing and verifying
this release the current priority. The unfinished evaluation and other
feature branches are outside this release candidate.

The manifest and both root lockfile versions are `0.10.0`. The ACP package
and macOS helper take their versions from that manifest. The changelog's
nonempty `0.10.0` section and README describe the release's actual features
and limits. This document is a preparation record, not proof of publication.

## Scope

- PR32's merged multi-IDE work, retaining the documented Preview and Planned
  support levels in the compatibility records; no claim of full IDE parity.
- M67 code intelligence, M69 web fetch, M68 verify loop and M79 plan files,
  already merged into the base.
- M72 turn checkpoints and the shared owner, Stop, trust, disposal and native
  command-entry fixes described in [M72](m72.md). Stored file restore and
  Redo require an attached Model API session and confirmed process safety.
- Existing Windows Muse Code limitations remain as documented. No new model
  calls or paid feature purchases are part of these release checks.

## Required candidate evidence

Still open at preparation:

1. Final staged tree, no unstaged changes, and independent source/evidence
   review after all fixes and deliberate failures are restored.
2. Fresh `npm ci` and literal `npm run quality` on Windows host, Windows VM,
   Mac mini and Kubuntu, recording terminal exits and exact tree bindings.
3. Affected native filesystem and process tests, real temporary-directory
   aliases, package/runtime checks and the supported VS Code floor.
4. Staged secret scan, normal commit with the tested tree, exact-head hosted
   checks and protected PR55 merge. No gate bypass or force push.

The release tag must name the tested `0.10.0` commit after it is on main.

## Distribution acceptance

Every channel remains open until actual public evidence exists:

| Channel             | Required public evidence                                                                                                 | Status |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------ |
| GitHub release      | `v0.10.0`, VSIX and ACP tarball downloads, payload digests and manifests                                                 | Open   |
| VS Code Marketplace | Published `0.10.0`, downloaded VSIX payload and ordinary isolated installation/activation                                | Open   |
| Open VSX            | Published `0.10.0` in the intended publisher namespace, downloaded payload and ordinary isolated installation/activation | Open   |
| npm                 | `muse-spark-code-acp@0.10.0`, registry integrity matching the public tarball and an isolated installed-agent smoke test  | Open   |

Record Windows host, Windows VM, Mac mini and Kubuntu smoke results against
the downloaded packages. A workflow success or skipped publishing step does
not establish availability. Tests use owned empty or unavailable credential
contexts and do not inspect, erase or reuse the owner's stored credentials.
