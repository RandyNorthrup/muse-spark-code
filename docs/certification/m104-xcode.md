# M104g — Xcode receipt

Recovery lane RLF-M104G. Base: main at 0.19.0 (`4ecbbd9cc5`). Rig: `macmini`
macOS 15.7.4 Intel (worktree `/Users/randy/lanes/RLF-M104G`). Xcode 26.3
(17C529). No pushes, paid calls, live model calls, or credential reads.
Date: 2026-10-23.

**Status: failed (harness runs; the conformance target does not exist).**
The toolchain works and the product builds; only the test side is missing.

## Evidence

- `node hosts/xcode/Scripts/generate.mjs`: OK (Generated/ sources written).
- `xcodebuild -project hosts/xcode/MuseSpark.xcodeproj -scheme MuseSpark
-configuration Debug -derivedDataPath temp/m104x/DerivedData -destination
'platform=macOS' build CODE_SIGN_IDENTITY=-`: **BUILD SUCCEEDED** (app +
  editor extension, ad-hoc signed).
- Same invocation with `-only-testing:MuseSparkTests/ConformanceTests
test` (exactly as `hosts/xcode/run.mjs` runs it): exit 70,
  `xcodebuild: error: Failed to build project MuseSpark with scheme
MuseSpark.: Tests in the target "MuseSparkTests" can't be run because
"MuseSparkTests" isn't a member of the specified test plan or scheme.`

## What is missing

1. The `MuseSparkTests/ConformanceTests` bundle the runner invokes does
   not exist in the project.
2. The test target that does exist (`NativeHostTests`) compiles sources
   from `test/m104/mac/`, which does not exist.
3. The remaining scaffolding is fake-bound: `Scripts/prepare-tests.mjs`
   builds `test/hosts/xcode/fake-runtime.ts`, and
   `Generated/NativeTests.xctestplan` points `MUSE_XCODE_RUNTIME` at
   `temp/m104x/fake-runtime`. Both violate the real-code rule and were not
   run.

This row moves when a real `ConformanceTests` target exists that drives
the shared suite against the production runtime and writes the
observations file, with no fake in the path.
