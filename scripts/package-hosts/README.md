# Native host distribution (M104-I)

This tooling builds Muse Spark Code (Unofficial) host artifacts. It does not
declare any editor Supported. Native qualification and registry accounts remain
separate release requirements.

Each existing `hosts/<host>/distribution.json` injects its native toolchain and
harness. Host ids are `jetbrains`, `visualstudio`, `eclipse`, `zed`, `xcode`,
`qtcreator`, `neovim`, `emacs` and `sublime`. Only an absent host folder produces
`skipped-host-absent`, with that folder named. An existing incomplete folder,
failed command, empty artifact or missing scenario fails.

The strict manifest interface is:

```json
{
  "mhp": "mhp/1.3.0",
  "build": [{ "command": "native-tool", "args": ["build-and-test"] }],
  "conformance": { "command": "native-tool", "args": ["mhp-harness"] },
  "artifacts": ["relative/path/to/archive.zip"]
}
```

Commands above document the injected interface; they are not shipped commands
or fake implementations. Optional `sign` and `publish` entries use the same
command/args shape. Host owners supply real commands in their own folders.
Commands execute directly, without an implicit shell. On Windows, use an
executable launcher such as `powershell.exe` for `.ps1` or `cmd.exe` for `.cmd`.

The build receives `MUSE_HOST_RUNTIME` pointing at a copy of the production ACP
staging tree and `MUSE_MHP_VERSION=mhp/1.3.0`. Native packaging must include that
runtime and install the exact keyring version from its manifest for each target
platform. The distribution command does not mutate the shared dependency tree.
Build and harness children receive a credential-stripped environment.
Artifact paths must remain inside the host folder, including after symlink
resolution. A receipt records the source tree, product version, MHP range and
SHA-256 of every copied artifact and every injected runtime file, including
all portable deferred modules. Runtime/product versions and the locked keyring
dependency must match. Nested symlinks, special files, missing/changed/unlisted
portable modules and native mutation of the injected runtime fail before a
receipt is emitted. `runtimeSha256` records build inputs; an installed-host
receipt must separately verify the runtime inside its exact archive. A package
receipt alone is not an editor qualification receipt.

The harness reads `test/hostApi/scenarios/contract.json` from stdin, runs every
scenario against the fake Muse Code CLI and fake Model API, and writes one JSON
report to stdout; native tool logs belong on stderr:

```json
{
  "protocol": "mhp/1.3.0",
  "host": "jetbrains",
  "results": [
    {
      "backend": "musecode",
      "scenario": "conversation",
      "skipped": false,
      "observations": { "turns": ["first", "second"], "responses": 2 }
    }
  ]
}
```

This abbreviated report demonstrates the shape; it fails the runner because
the remaining scenarios and second backend are missing. Observations come from
the real native harness, never copied from `expected`. The runner compares
each required observation and refuses duplicate, omitted or skipped results.
Scenario operations are harness driver actions, not new MHP wire methods.
The frozen method-table and panel-carrier tests run alongside the runner tests.

See `docs/certification/m104-i.md` for executed commands, drills, absent hosts
and the integration handoff for lane J's root documentation.

The local readiness checks are:

```sh
npm run check:mhp
npm run test:host-api
npm run check:host-conformance
npm run package:host -- jetbrains
```

The test command runs distribution guards and both frozen MHP suites in groups
of at most three files. Packaging requires the production ACP staging tree;
an absent folder is explicitly reported and produces no native artifact.

Signing and publishing use optional injected commands. The release helpers
validate the host, product version, source tree, complete inventory and every
SHA-256 before a channel command runs. Missing secrets and registries are
named; missing certificate/key pairs fail, and passwords are optional for
unencrypted signing material. Xcode without Developer ID and
notarization credentials is marked `unsigned-local-only`. Channel commands
receive only their own supplied credentials, and their captured output never
reaches the log. Recovery consumes previously signed bytes without re-signing.

The native publish job also downloads the archive and receipt from the tagged
GitHub Release and compares their bytes before dispatching the registry command.
Missing attachments fail before registry publication. The existing release job
now waits for native signing/recovery, preserves each downloaded receipt's
directory, and verifies/stages every present native host through the shared
helper. Native archives and receipts enter the same SHA256SUMS, attestation and
GitHub asset inventory as the VSIX/ACP packages. An incomplete present host
fails this prerequisite; only genuinely absent folders retain named skips.
The official Node pin manifest still needs approved offline vendor checksums
or separate network authorization. Production manifests, installed archive
payload verification, hosted release execution and per-editor qualification
remain missing. No native release readiness or support is claimed.

[Enjoying Muse Spark Code? A star on GitHub helps other people find it.](https://github.com/RandyNorthrup/muse-spark-code)
