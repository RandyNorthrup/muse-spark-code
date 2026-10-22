---
name: maker_simulation
description: Choose local QEMU, Renode, Gazebo or virtual printer checks, or explicitly requested Wokwi cloud runs with a private user token.
---

# Firmware and machine simulation

Use the smallest simulator that covers the behavior being tested. Read
local guidance first; load Wokwi guidance only for an explicit cloud choice.

Read only the topic needed for the current task. Resolve topic paths relative
to this SKILL.md (under `${SKILL_ROOT}/maker_simulation` for a bundled catalogue).

- [local.md](local.md): simulator selection and local test boundaries
- [wokwi.md](wokwi.md): cloud disclosure and token handling

Hardware access requires the user's workspace hardware switch. Before every
connect, flash, serial write or actuation, ask through the host's approval
surface for the exact target and payload; wait for Send once. A confirm flag
or a token the model can set is never approval. If the host cannot ask or
refuses the action, stop; do not reroute it through shell or MCP. Never suggest
bypass modes. Headless and unattended workers do offline and observe work
only; do not create a hardware allowlist for them.

Identify the physical stop before connecting: a machine's physical E-stop
or the user's safe means of disconnecting the board and its separate actuator
supply. A software stop is not an emergency stop. Keep the user present for
physical work. Never print or commit secrets.h, settings.toml, ESPHome
secrets.yaml or sdkconfig Wi-Fi values. Use the host's secret store for
machine credentials; never request them in chat or put them in commands.

These instructions apply in the panel, ACP editors and the companion page,
with the host's own prompt. Ports belong to the computer running the engine;
a cloud workspace has offline tools and simulators, not the user's USB ports.
Use the chosen model's capability record: tool calls need tools support,
render or board-photo feedback needs vision. Do not change the user's model.
