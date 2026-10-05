# Muse Spark Code (Unofficial) for JetBrains

This plugin embeds the repository's shared React panel in JCEF and implements
the frozen MHP 1.1 host contract. It requires IntelliJ Platform 2025.3 or later,
JDK 21 for development, and the `muse-spark-code-acp` executable on PATH. The
runtime is developed separately in M104 lane B. No credential is accepted by
the plugin; credentials remain in the runtime's operating-system store.

Build from the repository root:

```sh
npm run build
./hosts/jetbrains/gradlew -p hosts/jetbrains test detekt ktlintCheck buildPlugin --no-daemon
node --test hosts/jetbrains/test/embedded.test.mjs
```

The ZIP in `hosts/jetbrains/build/distributions/` contains the shared panel,
the frozen exported schemas, all 15 translated tables and generated chat,
Tasks and What's New pages. Install the ZIP through the IDE's plugin installer.
The right-hand Muse Spark Code tool window starts the runtime in the project's
directory. When JCEF is unavailable, the plugin requests the runtime's
companion route instead.

Native document reads use open buffers. Edits require workspace trust, a
matching document version, a clean writable buffer and non-overlapping UTF-16
ranges, and run in one undo command. All child environments remove credential
variables. Runtime stderr is drained without copying its contents into logs.
Browser assets stay on a fixed, intercepted origin with no remote network
access, popups, navigation or developer tools.

The plugin advertises only implemented native capability groups. Other groups
use the fallbacks declared in the frozen contract, including runtime settings
and storage, the React diff and terminal pages, and LSP code intelligence.

This is a development artifact, not a supported Marketplace release. The
qualification evidence, F1–F56 coverage and outstanding integration work are
in [the lane certification](../../docs/certification/m104-e.md). Distribution,
signing, the all-IDE verifier matrix and end-to-end runtime qualification are
owned by lanes I and J.
