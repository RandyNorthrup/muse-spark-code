The person approves **this exact outgoing payload**, identified by its SHA-256
digest, after reviewing its canonical rendering and structured summary. The
host recomputes the digest from the frozen bytes it will send and refuses a
mismatch. Approval does not claim that the person looked at every byte.

Control pictures make CR (`␍`), LF (`␊`, followed by a line break), TAB (`␉`),
NUL (`␀`) and ESC (`␛`) visible. Invalid UTF-8 bytes, hidden Unicode controls
and combining marks, including UTF-8 BOMs at any position, use `\xNN` byte escapes; a literal backslash is doubled.
The fixed-width rendering wraps to the measured container width and mounts
only visible rows. Search includes unmounted rows, and Next highlight reaches
each highlighted construct.
CR-only endings also break rows; CRLF remains one line ending. Summary command
boundaries follow the same rule, and padded numeric command codes are normalized.
Compound blocks disclose effects the summary cannot fully analyse.

At most 200 rendered rows require reaching the end of the real payload
scroll container once. Larger payloads require confirming the summary and
digest. Highlighted dangers always require a separate acknowledgement. Reject
and Send once have equal sizing and styling. Closing or expiry rejects;
read-only previews cannot authorize a send.

G-code summaries show distinct temperature settings and their maxima for
extruder, bed and chamber, fan maximum, feed maximum,
host-provided travel extents beside configured limits, line count and an
estimated time when the payload supplies one. Temperatures or moves beyond
known limits, unknown limits/effects and disabled safety checks are highlighted.
Every M302 spelling, power commands, soft-limit and protection changes require
the extra acknowledgement. Klipper and RepRapFirmware equivalents with no
portable mapping to the configured heater limits are highlighted conservatively.
The summary supplements the host analysis; it never admits a hardware action.
The summary lists the first eight distinct settings and the complete count,
so large jobs keep the controls responsive. Unknown bounds or limits are
explicit; the current machine contract has no configured chamber limit.
Flash review shows the target and exact outgoing byte size, and an ELF entry
point when present. Commands that refer to firmware files do not expose those
files' size or entry point; this is stated explicitly rather than inferred.
MicroPython commands therefore show an unknown entry point when their outgoing
bytes do not contain that metadata. The review always shows the frozen target.

Stop all remains in a bounded viewport region, with individual machines in an
internally scrolling list. Stop is available during loading, preparation and
failure, with hardware, trust and attended admission off. It never asks for
approval. Software Stop does not replace a physical emergency stop.

Retry saves the chat and maker request state, then reloads the panel document
to refetch its whole module graph, including failed static dependencies.
Review confirmations and grants are cleared. Close dismisses a failed view
and restores chat. The maker review, fallback and validation load in a second
lazy closure; the existing startup and surface budgets remain unchanged.

These shared surfaces work through HostBridge in the extension and companion
page. Native and ACP adapters must route completed review to the portable
host's review callback. Installed-editor and physical-device qualification
remain with the adapter/integration lanes; this lane uses simulators only.
