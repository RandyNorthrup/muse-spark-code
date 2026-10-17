# Sanitizers

Historical verification snapshot: on 2026-07-26, the listed sanitizer examples
trapped deliberately planted defects on the tested machine. Compiler support,
runtime behavior, and overhead vary by platform and release; rerun the canaries
in the target toolchain before treating a sanitizer as a gate.

Sanitizers are **runtime** tools. They find bugs on code paths your tests
actually execute; they prove nothing about paths you never run. Pair with
coverage.

## Availability

| Sanitizer | gcc 15 | clang 21 | Rust (nightly) | Catches |
|---|---|---|---|---|
| ASan | yes | yes | yes | use-after-free, buffer overflow, double-free |
| LSan | yes | yes | yes | memory leaks (bundled into ASan) |
| UBSan | yes | yes | — | UB: overflow, bad shift, misaligned, null deref |
| TSan | yes | yes | yes | data races |
| MSan | **no** | yes | yes | reads of uninitialized memory |
| Integer | no | yes | — | unsigned wraparound, lossy truncation |

MSan is clang-only — gcc has never implemented it.

## Build flags

```bash
# ASan + LSan + UBSan — the default pairing for a debug/test build.
# ASan and TSan cannot be combined; they use incompatible shadow memory.
g++ -fsanitize=address,undefined -fno-sanitize-recover=all \
    -fno-omit-frame-pointer -g -O1 prog.cpp -o prog

# TSan — separate build.
g++ -fsanitize=thread -fno-omit-frame-pointer -g -O1 prog.cpp -o prog

# MSan — clang only, and see the caveat below.
clang++ -fsanitize=memory -fsanitize-memory-track-origins=2 \
        -fPIE -pie -fno-omit-frame-pointer -g -O1 prog.cpp -o prog
```

`-fno-sanitize-recover=all` makes recoverable UBSan checks **abort** instead of
reporting and continuing. Some checks are already non-recoverable; this flag
makes the gate behavior consistent.

`-O1` and `-fno-omit-frame-pointer` commonly improve stack traces. Higher
optimization can inline frames, so measure and inspect the target build.

## Runtime options

```bash
export ASAN_OPTIONS=detect_leaks=1:abort_on_error=1:strict_string_checks=1:detect_stack_use_after_return=1:check_initialization_order=1
export UBSAN_OPTIONS=print_stacktrace=1:halt_on_error=1
export TSAN_OPTIONS=halt_on_error=1:second_deadlock_stack=1
export LSAN_OPTIONS=suppressions=.lsan-suppressions.txt
```

`detect_stack_use_after_return=1` enables stack-use-after-return detection on
toolchains where it is not already the runtime default.

## CMake preset

```cmake
option(ENABLE_SANITIZERS "Build with ASan+UBSan" OFF)
if(ENABLE_SANITIZERS)
  add_compile_options(-fsanitize=address,undefined -fno-sanitize-recover=all
                      -fno-omit-frame-pointer -g)
  add_link_options(-fsanitize=address,undefined)
endif()
```

Then `cmake -DENABLE_SANITIZERS=ON -DCMAKE_BUILD_TYPE=RelWithDebInfo ..`

## Rust

Needs a compatible nightly toolchain plus `-Zbuild-std`, because the shipped
`std` is not instrumented by this command.

```bash
RUSTFLAGS="-Zsanitizer=address" \
  cargo +nightly test -Zbuild-std --target x86_64-unknown-linux-gnu
```

Swap `address` for `thread`, `memory`, or `leak`. Keep the explicit `--target`
so `-Zbuild-std` rebuilds for the intended instrumented target.

## Caveats

- **ASan and TSan are mutually exclusive.** Two separate builds, two CI jobs.
- **MSan needs the *entire* program instrumented, including libstdc++/libc++.**
  Ubuntu does not ship an instrumented standard library, so MSan on real C++
  code (anything touching `std::string`, `std::vector`, iostreams) produces
  false positives from uninstrumented library internals. The trivial test above
  passes because it touches no library code. To use MSan seriously you must
  build libc++ with `-fsanitize=memory` yourself. For most C++ work, ASan +
  UBSan + valgrind is the practical set.
- **Sanitizers change timing.** TSan in particular can hide or expose races
  differently from production. A clean TSan run is evidence, not proof.
- **Resource cost**: sanitizer overhead depends on the program, toolchain, and
  enabled checks. Measure the target workload before sizing CI runners.
- **valgrind vs ASan**: valgrind needs no sanitizer rebuild and can complement
  ASan, but is commonly slower. Prefer measured results for the target binary.
- **Managed-code diagnostics differ.** Ordinary C# and Python projects do not
  use these C/C++ compiler sanitizer flags directly. For C#, consider built-in
  analyzers plus `dotnet-counters`/`dotnet-dump`; for Python, `tracemalloc` and
  `faulthandler`.
