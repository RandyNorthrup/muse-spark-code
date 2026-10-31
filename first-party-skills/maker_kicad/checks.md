# KiCad checks

Use the user's KiCad version and existing project libraries. Run ERC and DRC
on local files, retaining reports even when violations cause exit 5.
<!-- recipe:kicad-erc -->

```sh
kicad-cli sch erc --format json --exit-code-violations -o erc.json board.kicad_sch
```

<!-- recipe:kicad-drc -->

```sh
kicad-cli pcb drc --format json --schematic-parity --exit-code-violations -o drc.json board.kicad_pcb
```

Report severity, affected nets/pads and the user's intended exceptions;
never disable a rule to make the report green. Use CLI exports rather than
claiming the editor IPC API can export. Do not guess undocumented JSON
fields: use the captured check summary or inspect the actual report.

Review power budget, component ratings, clearances and connector pinout
against the exact datasheets. Pinout images and a clean DRC cannot prove
mains, battery or high-current hardware safe. Do not order boards or energize
the circuit as a check. Any real pin/relay write needs the host's approval
surface and a user-defined safe physical supply disconnect or E-stop.

[KiCad CLI](https://docs.kicad.org/9.0/en/cli/cli.html),
[IPC API limitations](https://dev-docs.kicad.org/en/apis-and-binding/ipc-api/for-addon-developers/index.html).
