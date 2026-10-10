# M9 Linux offline dictation — CM9LNX

Scope: local VS Code-family composer on Linux x64/arm64. Windows and macOS
retain their existing helpers. No paid API or live model calls are authorized
or used. Native runtime composer rows remain C-M9-1/C-M104-1 (JetBrains,
Visual Studio, Eclipse, companion); Zed, Xcode and terminal ACP/Neovim/Emacs/
Sublime require that bridge or C-M9-1's explicit microphone-surface exception.
Remote workspace hosts still cannot capture the local microphone.

The 2026-10-10 rig brief supersedes completion-program.md's old Linux engine
prohibition. The archived M9 acceptance retains insertion, tap/hold, stop,
resident helper and no cost; CM9LNX adds offline Linux capture, prebuilt
architectures, consented pinned acquisition, removal and real recognition.

Synthetic fixtures use FFmpeg libflite's `slt` voice, 16 kHz mono PCM16.
They are an engineering comparison, not a human-speech accuracy claim.

## Engine decision (Kubuntu, 2026-10-10)

| Engine                         | Fixture errors / 23 words | 10 s clip wall time               | Engine binary           | Model                                              |
| ------------------------------ | ------------------------- | --------------------------------- | ----------------------- | -------------------------------------------------- |
| Vosk 0.3.45 / small-en-us-0.15 | 3 / 23 (13.04%)           | 1.454 s warm + 0.551 s model load | 25,986,496 B libvosk.so | 41,205,931 B ZIP; 70,898,967 B extracted directory |
| whisper.cpp 1.7.6 / tiny.en    | 1 / 23 (4.35%)            | 1.644 s including load            | 2,457,040 B static CLI  | 77,704,715 B                                       |
| whisper.cpp 1.7.6 / base.en    | 1 / 23 (4.35%)            | 3.364 s including load            | same CLI                | 147,964,211 B                                      |

Chosen: **whisper.cpp 1.7.6, tiny.en**, CPU-only, three threads, native CPU
optimization disabled for portable builds; x64 and arm64 supported upstream.
Base adds size and latency without improving these fixtures. Vosk's smaller
weights require a substantially larger shared engine and scored worse here.
Numbers are single wall-clock observations on the shared rig, not throughput
claims. The 10 s fixture is sentence 1 padded with silence.

Fixture 1: “Please open the project and run the tests.” All three exact.
Fixture 2: “Create a new file and save the changes.” Vosk wrote “fell”;
Whisper tiny/base wrote “fellow”. Fixture 3: “The microphone records speech
on this computer.” Vosk wrote “microfilm record”; both Whisper models exact.
WER ignores punctuation/case and uses word edit distance.

Sources: [whisper.cpp code, MIT](https://github.com/ggml-org/whisper.cpp/tree/v1.7.6),
[Whisper original code and weights, MIT](https://github.com/openai/whisper#license),
[converted model, MIT](https://huggingface.co/ggerganov/whisper.cpp),
[Vosk code, Apache-2.0](https://github.com/alphacep/vosk-api/blob/v0.3.45/COPYING),
[Vosk model, Apache-2.0](https://alphacephei.com/vosk/models).
No benchmark dependency enters package.json or node_modules. FFmpeg/libflite,
cmake, g++ and Python were already installed; only candidate archives/models
were fetched into the lane's private TMPDIR. No speech went over the network.
