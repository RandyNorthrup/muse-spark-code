# M98-2j: per-connection local judge design spike

2026-10-05, branch `m98/2j`, base `0433091f`, native Windows 11 rig
`win11`. Authority: `C:/lanes/_ctx/M98-2J.rig.md`, shared lane rules,
PLAN.md D77 / M98 2j, and [the original research](m98-research.md).

## Outcome and scope

**Outcome (a): verified local inference is feasible on this native Windows
configuration, checked on each content-bearing connection before any HTTP
byte.** The connection's server-side TCP row resolves to the installed,
fingerprinted Ollama binary under the caller's SID, with a stable PID and
process creation time. Its served model manifest digest matches the local
manifest, and every referenced blob is hashed, including the weights.
Twenty-six synthetic inference calls used this complete check; all completed.

This is a design feasibility result, not product certification or a claim
about all local endpoints. The prototypes are reachable only from tests.
No product entrypoint, setting, automatic discovery, confidential-workspace
selection, download or inference feature is wired. A supported native
Windows implementation can follow this design, with the residuals below.
Linux, macOS, WSL, containers, remote extension hosts and unrecognized
installations remain **unverified**. They must use outcome (b)'s policy if
exposed: an explicitly entered endpoint labelled **unverified local
endpoint**, unavailable in confidential workspaces and never auto-selected.

The real authenticated self-SSH forward could not be established on this
rig. That fixture remains open and is not included in the claim of passed
adversarial fixtures. The real same-user TCP relay exercises the forwarding
threat successfully. Extension-host execution and the other native OS
designs also remain build-entry checks; this run used headless Node.

## Windows evidence and connection sequence

Rig: Node `24.21.0`, Ollama `0.35.1`, GTX 1080 Ti. Existing Scheduled Task
`OllamaServe` was left alone. No models were pulled, removed or explicitly
unloaded; requests used a five-minute `keep_alive` only.

Observed listener: `127.0.0.1:11434`, PID `18576`, creation FILETIME
`134356345988239984`. The installed executable was
`%LOCALAPPDATA%/Programs/Ollama/ollama.exe`. `Get-AuthenticodeSignature`
returned `Valid`, signer `Ollama Inc.`; its SHA-256 was
`3cc17c238b081adf2bd3a206e52a063b637af1bf283d95b4ffd73a2bdec8b027`.
This captured fingerprint is the test's trust anchor, not a fingerprint
learned from whichever socket happens to answer. An update changes it and
therefore fails verification until the new installation is vetted.
The model root resolves to `%USERPROFILE%/.ollama/models` on `C:`, which
`System.IO.DriveInfo` reports as a fixed NTFS drive on this rig.

The [reviewed Windows C# helper](../../native/windows/MuseSparkLocalJudgePeer.cs)
uses the same local compilation pattern as the Windows job helpers: the
Framework C# compiler, a source-hash-named executable under the worktree's
ignored `temp/` directory, and direct `execFile` with an argument array.
Only `SystemRoot` is passed in its environment. No PowerShell, shell,
credential environment or request body enters the helper.

For a client socket `(clientAddress, clientPort, serverAddress, serverPort)`:

1. Connect `node:net` to the selected IP literal. The peer and local
   addresses must both be loopback. No HTTP object exists yet.
2. Query `GetExtendedTcpTable` with `TCP_TABLE_OWNER_PID_CONNECTIONS`, using
   the socket's actual family. Match **one ESTABLISHED server row** with
   local endpoint `(serverAddress, serverPort)` and remote endpoint
   `(clientAddress, clientPort)`. A listener-only lookup is never used.
3. Open that PID with `PROCESS_QUERY_LIMITED_INFORMATION | SYNCHRONIZE`.
   Read `QueryFullProcessImageName`, `GetProcessTimes` and the process token's
   SID. Require the caller's SID, the known install path, basename
   `ollama.exe`, and the captured installed executable digest. Hash the
   executable file itself on every probe.
4. While holding the process handle, read the TCP table again and require
   the same tuple/PID. Require `WaitForSingleObject(handle, 0)` to report a
   live process. Return the 64-bit creation time as a string, never a JS
   number. All helper output crosses a strict zod schema.
5. Fetch `/api/tags` over that verified metadata socket. Create a fresh
   content socket and repeat the peer check, requiring the metadata peer's
   PID, creation time, path, SID and executable digest. Nothing is cached
   across connections.
6. Parse the captured tag/manifest shapes. Hash the raw local manifest
   bytes and compare their digest with the selected served tag. Open and
   stream-hash **all** config/layer blobs, checking their sizes, exact file
   identities and modification times before/after reading. Require a model
   weight layer, canonical paths without redirected components, and an
   unchanged manifest. Reject missing, duplicate or malformed models.
7. Recheck the content socket's OS peer after hashing and again after
   writing the private measurement ledger. Require the same generation.
   Assert `socket.bytesWritten === 0` before dispatch. Then construct
   `http.request` using **that socket** through `createConnection`, without
   an agent. Destroy the socket on completion or refusal. Never reconnect.

The helper's ABI is reviewed against Microsoft's
[TCP table API](https://learn.microsoft.com/en-us/windows/win32/api/iphlpapi/nf-iphlpapi-getextendedtcptable),
[IPv4 row](https://learn.microsoft.com/en-us/windows/win32/api/tcpmib/ns-tcpmib-mib_tcprow_owner_pid)
and [IPv6 row](https://learn.microsoft.com/en-us/windows/win32/api/tcpmib/ns-tcpmib-mib_tcp6row_owner_pid).
Manifest hashing follows the
[Ollama 0.35.1 source](https://github.com/ollama/ollama/blob/v0.35.1/manifest/manifest.go);
the actual bytes and served digest were independently captured here.

The served model was `qwen3:4b-instruct-2507-q4_K_M`:

| Item                                   | Captured value                                                     |
| -------------------------------------- | ------------------------------------------------------------------ |
| Manifest SHA-256 / served tag digest   | `0edcdef34593eac1aa2be9c7d06c432dcf81945adca5eca2f27662c18f168ba0` |
| Weight blob SHA-256                    | `85e4a5b7b8ef0e48af0e8658f5aaab9c2324c76c1641493f4d1e25fce54b18b9` |
| Weight bytes hashed per content socket | 2,497,280,480                                                      |
| Other referenced blobs                 | Config, template, license and parameters; every digest matched     |

The wire capture is
[localJudgeCapture.json](../../test/unit/fixtures/localJudgeCapture.json).
Capture workspace: this worktree, with **synthetic text only**; one counted
inference attempt preceded the parsers. `/api/version`, `/api/tags`, the
local manifest and `/api/chat` were captured before schemas were written.
Extra wire fields remain present; schemas validate the fields they use.

The capture transport initially set `agent: false` alongside
`createConnection`. Inspection of Node's actual `ClientRequest` source
showed that this makes a new Agent, which can open another socket. That
first inference is **capture-only, not verified-transport evidence**. The
prototype removes the agent option. A dedicated real-server test asserts
one connection and that the HTTP request's client port equals the verifier's
socket port; deliberately restoring `agent: false` must fail it.

## Adversarial fixtures

| Fixture                                     | Evidence / result                                                                                                                                                                                                                                          |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean close and reconnect                   | Each request creates a fresh socket and invokes its verifier. A second refused verifier writes zero content; an ended peer is refused. No authorization survives a close.                                                                                  |
| Replacement within an old TTL               | A separate Node listener is closed, another process immediately binds its old port, and the fresh TCP-table lookup identifies the replacement. It is unverified. No TTL exists in this design.                                                             |
| Simultaneous connections on one listener    | Two live sockets to the same process have different client ports and independently resolve to the correct server PID. This proves the helper needs the whole tuple.                                                                                        |
| PID reuse                                   | Simulated same PID/path/SID with a different exact creation FILETIME is unverified. A changed PID is also unverified. No actual OS PID reuse is claimed.                                                                                                   |
| IPv4 versus IPv6                            | Separate child Node processes bind `127.0.0.1` and `::1`. Each actual socket resolves to its own PID, and both are unverified as runtimes. No mapped-address normalization can borrow another family's owner.                                              |
| Same-user TCP relay                         | A tiny separate Node process relays to another real loopback HTTP server. The OS row identifies the relay, not its valid upstream, and rejects it before any request body.                                                                                 |
| SSH / WSL / renamed proxy                   | Simulated process identities for `ssh.exe`, `wslrelay.exe` and `ollama.exe` outside the installation fail the runtime guard. A modified binary at the correct path fails the digest guard.                                                                 |
| Real `ssh -N -L` to this machine's sshd     | `sshd` was running, but a noninteractive self-login failed `Permission denied (publickey,password)`; the agent service was stopped. No authentication settings, key material or known-host files were changed. An authenticated tunnel was **not tested**. |
| Missing row / failed helper / closed socket | Explicit failures, never empty success. A killed owner and an invalid helper invocation are refused.                                                                                                                                                       |
| Model provenance faults                     | Modified blob with the same size, wrong size, missing blob, changed manifest, absent/duplicate tag and path-traversing name all fail.                                                                                                                      |
| Redirect / wrong network / oversized data   | Non-loopback results, HTTP credentials/schemes/paths, redirects, malformed JSON and over-limit bodies are refused. No redirect target receives a request.                                                                                                  |

The self-login prerequisite was attempted with:

```powershell
& 'C:/Windows/System32/OpenSSH/ssh.exe' -n -T -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=no -o UserKnownHostsFile=NUL -o GlobalKnownHostsFile=NUL Randy@127.0.0.1 exit
```

It exited 1. With already authorized noninteractive authentication, the
remaining fixture should start `ssh -N -L 127.0.0.1:<fixture-port>:127.0.0.1:11434`
to `127.0.0.1`, then run the same peer guard against that port. The expected
owner is `ssh.exe` and the result must be unverified before any HTTP byte.
Do not count a failed login or absent listener as an authenticated-forward
test.

## Call ledger and latency

**27 free inference attempts, 27 responses; zero paid/cloud inference calls.**
One wire capture, ten completed calls in the first benchmark, eight in the
streaming benchmark and eight in the final regression benchmark. Including
metadata, the conservative total is **at most 56 Ollama HTTP requests**:
27 inference, one version and at most 28 tag requests, including an allowance
for the timed-out iteration's pre-dispatch metadata. This stays below the
brief's 60-call limit. Every state was `git status` or
`rm -rf synthetic-folder`, alternating a fixed yes/no question. No command
was executed and no repository content was sent. Every answer was one token:
`no` for status, `yes` for the destructive synthetic command, with five
returned logprob alternatives. This tiny set measures timing, not accuracy
or calibration. `qwen3:1.7b` was not called.

The [complete counted ledger](m98-2j-calls.json) retains all twenty-seven receipts
and marks the capture-only transport explicitly. The first benchmark's
planned twelve-call test hit its unchanged 120-second deadline after ten
completed dispatches, while hashing before the next dispatch. Its durable
pre-send ledger contains only those ten calls. The final benchmark uses
eight samples and larger streaming read chunks; the streaming run passed in
70.81 seconds and the final pathname-swap regression run in 78.46 seconds.
No timeout was raised and no inference assertion was removed.

Final seven warm samples after one reload, nearest-rank percentiles (p95
with seven samples is their maximum):

| Measurement                                         |     p50 |     p95 |         Range |
| --------------------------------------------------- | ------: | ------: | ------------: |
| Ollama-reported inference duration                  |  119 ms |  319 ms |     79–319 ms |
| HTTP + inference after verification                 |  130 ms |  330 ms |     90–330 ms |
| Full pre-body verification                          | 8.118 s | 8.678 s | 8.045–8.678 s |
| Full blob hashing within verification               | 7.429 s | 7.582 s | 7.393–7.582 s |
| Content connection, verification + HTTP + inference | 8.375 s | 8.845 s | 8.205–8.845 s |

The per-call metadata connection and one-time helper compilation are
outside the content-connection timer, so complete application latency is
greater than the final row. Cold capture: Ollama reported 29.254 s, including
28.976 s loading; the initial benchmark's first reload reported 7.985 s,
including 7.683 s loading. The final run's first reload reported 7.098 s,
including 6.811 s loading, and took 15.201 s on its content connection.
The real guarantee here costs seconds, even though
the model's warm answer is fast. Caching model hash evidence would need a
new immutable-file/lifetime design and its own race drills; do not reintroduce
a listener or peer TTL as a latency optimization.

To reproduce the free probe on this rig (explicit opt-in, no key):

```powershell
$env:MUSE_LOCAL_JUDGE_SPIKE='1'
npx.cmd vitest run test/e2e/judgeLocal.live.e2e.test.ts --maxWorkers=3 --testTimeout=120000
```

Other rigs do not run this probe by default. The installation fingerprint
is deliberately pinned to this capture. An unmatched version is refused.

## Linux design — unverified on this rig

No Linux helper or parser is shipped by this spike. These are the exact
diagnostic commands for a future native helper, not captured Linux wire
fixtures. Operate in the connecting process's own network namespace:

```sh
cat /proc/self/net/tcp /proc/self/net/tcp6
```

Convert the connected socket's **reversed** tuple to the table's address
encoding: IPv4 is little-endian hexadecimal, IPv6 reverses bytes within
each native 32-bit word, ports are four hexadecimal digits. For IPv4
loopback, server port 11434 and client port held in `client_port`:

```sh
server_hex=0100007F:2CAA
client_hex=$(printf '0100007F:%04X' "$client_port")
awk -v local="$server_hex" -v remote="$client_hex" '$2 == local && $3 == remote && $4 == "01" { print $8, $10 }' /proc/self/net/tcp
```

Require one established row and retain its UID and socket inode. Find its
owning process descriptor, refusing denied visibility or multiple owning
processes:

```sh
for link in /proc/[0-9]*/fd/*; do
  if [ "$(readlink "$link" 2>/dev/null)" = "socket:[$socket_inode]" ]; then
    printf '%s\n' "$link"
  fi
done
readlink "/proc/$peer_pid/exe"
stat -Lc '%d:%i' /proc/self/ns/net "/proc/$peer_pid/ns/net"
stat -c '%u' "/proc/$peer_pid"
sha256sum "/proc/$peer_pid/exe"
```

A small native helper must hold `pidfd_open(peer_pid, 0)` across verification,
read `/proc/<pid>/stat` field 22 without assuming the command name has no
spaces, resolve `/proc/<pid>/exe` to the vetted Ollama install and fingerprint,
and confirm the network/user namespaces and expected runtime UID. The start
time can be diagnosed without breaking on a spaced command name:

```sh
python3 -c 'import pathlib,sys; print(pathlib.Path("/proc/"+sys.argv[1]+"/stat").read_text().rpartition(")")[2].split()[19])' "$peer_pid"
```

Re-read the exact tuple/inode, descriptor ownership and creation identity
after hashing, poll the pidfd for exit, and send only on the held socket.
Use the runtime's explicitly established canonical model root (manual
install and system service roots differ); apply the same manifest/blob
hashes. Never inspect `/proc/<pid>/environ` for model-root discovery: it may
contain credentials. `hidepid`, denied descriptors, namespace differences,
container proxies, missing pidfd support or ambiguous ownership all give
unverified. Linux `/proc/net` is namespace-specific, not proof of the user's
physical machine. See the [Linux proc documentation](https://man7.org/linux/man-pages/man5/proc_pid_net.5.html).

## macOS design — unverified on this rig

No macOS helper or parser is shipped. Enumerate **established connections**
using numeric output and NUL-delimited fields, separately for each family:

```sh
/usr/sbin/lsof -nP -a -i4TCP@127.0.0.1:11434 -sTCP:ESTABLISHED -F0pcufnT
/usr/sbin/lsof -nP -a '-i6TCP@[::1]:11434' -sTCP:ESTABLISHED -F0pcufnT
/usr/sbin/lsof -nP -a -p "$peer_pid" -d txt -F0fDin
/bin/ps -p "$peer_pid" -o uid= -o lstart= -o comm=
/usr/bin/codesign --verify --strict --verbose=2 "$ollama_executable"
/usr/bin/shasum -a 256 "$ollama_executable"
```

The IPv6 selector must be quoted when passed through a shell to avoid glob
expansion; a helper passes it as one argument directly. Match the complete
server-side `local->remote` tuple including the actual client port; do not
accept an `lsof` process name or listener row as identity. Require one owner.
A native `libproc` helper must use `proc_pidpath` for the executable and
`proc_pidinfo(PROC_PIDTBSDINFO)` for UID and start seconds/microseconds, and
compare again after a second full tuple lookup and model hash. The human
`ps lstart` value is only diagnostic, not a generation key. Resolve the
vetted installation path (e.g. the installed Ollama app's actual executable,
not a symlink on PATH) and pinned code identity. Validate the canonical model
root and every manifest/blob digest as on Windows.

Restricted `lsof`/libproc visibility, multiple owners, an app update,
virtual-machine/remote-host ambiguity or a missing lifecycle proof gives
unverified. An authenticated forward is owned by `ssh`, and container
networking belongs to a proxy; neither is Ollama. Unlike Linux's pidfd,
macOS's exact process-lifetime binding still needs a captured native drill;
two `lsof` snapshots alone do not close it. Command/field semantics are from
the [lsof manual](https://lsof.readthedocs.io/en/stable/manpage/), not a Mac
execution receipt.

## Residual risks and build-entry conditions

- The OS, this helper and the vetted runtime are trust anchors. Hashing the
  executable path is not attestation of arbitrary injected process memory,
  and local file presence is not independent attestation of which weights
  trusted Ollama actually used. Same-user code injection, a compromised OS,
  native socket-handle transfer or a modified runtime is outside this proof.
  Do not use the phrase "verified local" to imply protection from those.
- A production trust anchor must verify supported installation/signature
  identity and define safe update/revocation handling. It must never learn
  the expected executable digest from an untrusted responding peer.
- Disk reads check native identity/size/mtime and actual digests, but do not
  hold all blobs immutable through inference. Concurrent model replacement
  after a snapshot is a remaining race. Production needs an explicit model
  installation/mutation threat model; ambiguity stays unverified.
  Production also needs to establish root/volume locality and reject network
  shares or redirected model roots; this spike vets the recorded fixed-drive
  configuration rather than providing a general mount verifier.
- Locality means the machine running Node. It does not establish that a
  remote extension host is the editor user's machine. Production must refuse
  that ambiguity before automatic/confidential use.
- A 30-second transport deadline closes its socket, and helper subprocesses
  are bounded. Disk I/O itself is not cancellable here; the test-only
  verifier may finish hashing after its socket was closed, but cannot send
  on that closed socket. Do not present this as a complete bounded-lifecycle
  implementation.
- Real self-SSH, real PID reuse, native Linux/macOS and installed-extension
  execution remain unverified. Run those fixtures before certifying those
  configurations. No credential or machine changes were made to force them.
- General-model confidence/calibration and `tev1:4b` recommendation remain
  the original research's separate questions. This spike changes neither.

## Gate and drill receipt

The owning files run directly on win11 with at most three files per Vitest
invocation, `--maxWorkers=3 --testTimeout=120000`. Full quality/coverage/a11y
and installed-host certification belong to the lead on the integrated tree
(PLAN.md section 7); no threshold, rule or ignore was weakened.

All seventeen deliberately broken variants exited 1 in their owning suites.
Each source was restored byte-for-byte; the before/after SHA-256 receipts
are in [m98-2j-drills.json](m98-2j-drills.json). The mutations were:

| Guard                 | Deliberate break                                                                 |
| --------------------- | -------------------------------------------------------------------------------- |
| Exact socket          | Restore `agent: false`; the server sees another socket/client port               |
| No bytes before proof | Write a byte while the asynchronous verifier is still running                    |
| Loopback lookup       | Remove the resolved-address refusal (resolver-only test; no external connection) |
| Redirect refusal      | Accept non-200 statuses                                                          |
| Input/output bounds   | Remove both body-size checks against the owned fake server                       |
| Port bounds           | Remove the pre-connect range/integer refusal                                     |
| Explicit port         | Treat port zero as an omitted port and silently substitute port 80               |
| Process generation    | Ignore creation FILETIME; the simulated reused PID is accepted                   |
| Process PID           | Ignore the changed PID                                                           |
| Caller SID            | Ignore the caller/process owner mismatch                                         |
| Installed fingerprint | Ignore the executable digest without a previous connection                       |
| Whole TCP tuple       | Remove remote/client-port matching; simultaneous connections become ambiguous    |
| Served manifest       | Ignore the raw manifest digest                                                   |
| Actual weight bytes   | Ignore the blob hash result                                                      |
| Named file identity   | Ignore the pathname sample while a replaced blob's original handle remains valid |
| Canonical model path  | Accept a junction redirecting the blob directory                                 |
| Installed binary path | Ignore the installation/basename and prior-path checks                           |

The pathname-swap regression also failed before its fix: the original
handle still hashed valid bytes while the named file had been replaced.
Checking the named file's native identity/size/mtime as well as the held
handle fixes it. All mutation tests use synthetic fixtures; none invokes
the opt-in inference suite or sends a request outside loopback.

The owning suites passed **47 tests across three files**, with no skips or
unhandled errors. The opt-in final Ollama suite passed its one eight-call
test. All checks below ran directly in this worktree on win11:

| Check                                    | Receipt                                                                       |
| ---------------------------------------- | ----------------------------------------------------------------------------- |
| `npm.cmd run typecheck`                  | All five projects exit 0                                                      |
| Scoped `npx.cmd eslint --max-warnings=0` | Exit 0; hook repeats it on staged TypeScript/JS                               |
| Scoped `npx.cmd prettier --check`        | Exit 0                                                                        |
| `npm.cmd run deadcode`                   | Plain knip exits 0; existing vendor ignore hint only                          |
| `npx.cmd jscpd`                          | Exit 0, zero clones across 857 files                                          |
| `npm.cmd run check:l10n`                 | Exit 0, fourteen tables, zero problems                                        |
| `npm.cmd run check:host-api`             | Initial stale snapshot fails; generated refresh reviewed; final check exits 0 |
| `npm.cmd run build`                      | Exit 0; sizes, splits, host globals and notices pass                          |
| Hook-on prototype commit `9389017`       | lint-staged and gitleaks pass; no leaks                                       |

Build sizes: extension **553.2 KiB / 600**, Model API **426.4 KiB / 475**,
checkpoint store **109.1 KiB / 225**. All other existing bundle caps pass.
No prototype path or distinctive guard string appears in the shipped JS
bundles. No new dependency, l10n key, escape hatch or ignored file was added.
The knip entry is the actual child fixture launched by path, not an ignore.

The generated host API snapshot includes the prototypes because its scanner
reads all core source, even test-only modules. Its Node module count rises
23 → 24 (`node:events`), and import-file counts follow the new modules. The
same refresh resolves the base branch's already documented FIXM98J
deferral: paidHost's twelfth API use and judge's earlier crypto import. The
271 VS Code APIs, eighteen adapter files and 59 theme variables remain the
same; host policy is unchanged.

The first commit attempt failed before hook tasks because this rig's MinGit
has GNU Bash under the name `sh.exe`, while npm's `npx` script requests
`bash`. A copy of that existing executable under the worktree's ignored
`temp/m98-2j/bin/bash.exe`, plus a process-local PATH, ran the unmodified
hooks successfully. No global installation, hook bypass or machine setting
was used. No merge, rebase or push was performed, as the rig brief requires.

The lead still owns full quality, coverage, accessibility, packaging and
installed-host certification on the integrated tree. Linux/macOS native
implementation, authenticated SSH forwarding and extension-host execution
are intentionally left as unverified build-entry conditions, not passing
receipts for this rig.
