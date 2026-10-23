# judgeSetup fixtures (M125 lane W)

`runtime.tgz` is a real gzip'd tarball in the pinned-runtime layout
(`bin/`, `lib/`), generated 2026-10-23 with GNU tar 1.35:

    tar -czf runtime.tgz -C <root> bin lib

The payload bytes are placeholders; the FORMAT is what the extractor
test proves — real tar output in, the same tree out. Regenerate with
the same command if the layout changes.
