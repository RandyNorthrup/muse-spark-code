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
  "mhp": "1.x",
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
staging tree and `MUSE_MHP_VERSION=mhp/1.1.0`. Native packaging must include that
runtime and install the exact keyring version from its manifest for each target
platform. The distribution command does not mutate the shared dependency tree.
Build and harness children receive a credential-stripped environment.
Artifact paths must remain inside the host folder, including after symlink
resolution. A receipt records the source tree, product version, MHP range and
SHA-256 of every copied artifact.

The harness reads `test/hostApi/scenarios/contract.json` from stdin, runs every
scenario against the fake Muse Code CLI and fake Model API, and writes one JSON
report to stdout; native tool logs belong on stderr:

```json
{
  "protocol": "mhp/1.1.0",
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
