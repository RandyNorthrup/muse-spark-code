# Arduino

List boards without opening ports; compile the user's existing sketch for its
confirmed FQBN. Replace FQBN and SKETCH with that project's values.
<!-- recipe:arduino-list -->

```sh
arduino-cli board list --json
```

<!-- recipe:arduino-compile -->

```sh
arduino-cli compile --fqbn FQBN SKETCH
```

Upload does not compile first. Before uploading or burning a bootloader, ask
through the host's approval surface for the exact board, port and built
artifact. Do not write AVR fuse or lock bits; the user handles those in their
own tools. Use a safe physical disconnect for the board and external loads.

A monitor connection can reset the board and needs host approval. Prefer the
bounded serial tool. arduino-cli monitor exits early when stdin is closed;
if a shell monitor is necessary, keep stdin open for the capture window and
also set a host process-tree deadline and output cap. Do not infer successful
monitoring from an empty exit. A 1200-baud open can enter the bootloader.

[Compile](https://arduino.github.io/arduino-cli/1.5/commands/arduino-cli_compile/),
[upload](https://arduino.github.io/arduino-cli/1.5/commands/arduino-cli_upload/).
