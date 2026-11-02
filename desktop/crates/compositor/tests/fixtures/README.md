# Recorded Hyprland captures (RLF-M111CP)

Outside-world input for the wire tests: every file is a byte-exact reply
or stream Hyprland 0.55.2 (Debian trixie-backports `0.55.2+ds-1~bpo13+1`)
sent during the lane's QEMU guest sessions on 2026-11-02 (QEMU 10.0.13,
virtio-gpu, `m111cp-deb` container on rig linuxlt).

Captured with the lane's scratch guest runner over the instance sockets:
`j/<command>` round trips on `.socket.sock`, the raw `.socket2.sock`
stream for the event logs. The runner saved each reply verbatim.

| File                   | Capture                                                                                                                            | Session                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `events-s1.log`        | the socket2 stream: workspace create/switch/destroy, both label renames, three keyboard adoptions                                  | iter12 (`boot12`, `M111CP-SESSION-OK`)                                     |
| `events-s3.log`        | the socket2 stream: window titles, opens, focus, moves between desktops                                                            | iter11 (`boot11`; iter12's copy was cut by the marker shutdown, see below) |
| `workspaces.json`      | `j/workspaces`: desktops 1 and 2, three windows on 2                                                                               | iter11 (`boot11`)                                                          |
| `monitors.json`        | `j/monitors`: the `Virtual-1` output                                                                                               | iter11 (`boot11`)                                                          |
| `clients.json`         | `j/clients`: the three foot windows (`cp-direct`, `cp-exec`, `cp-fb`); the adapter sends `ja/clients`, whose rows share this shape | iter11 (`boot11`)                                                          |
| `devices.json`         | `j/devices`: two mice, three keyboards                                                                                             | iter12 (`boot12`)                                                          |
| `activeworkspace.json` | `j/activeworkspace`: desktop 1                                                                                                     | iter12 (`boot12`)                                                          |
| `activewindow.json`    | `j/activewindow`: `{}` (nothing focused)                                                                                           | iter12 (`boot12`)                                                          |

Iter12's session ended at the `M111CP-SESSION-OK` marker, which stops the
guest before its late writes flush: its S3-side fixtures are empty files.
Iter11 ran the same S3 proofs to a clean poweroff on the same pin, so its
S3 captures are used instead, as labelled. Nothing here is hand-written.
