# Hardware matrix (M110os OS5)

QEMU is the authoritative matrix until owner hardware arrives (Q-M110).
Every image boots there on each change (OS6):

| Target            | Machine             | Firmware | Status                                                                                                                     |
| ----------------- | ------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- |
| x86-64            | QEMU, KVM           | OVMF     | authoritative; boot-tested on linuxlt (TCG on q35, login in 163 s, zero failed units), OS6 CI runs the same image with KVM |
| ARM64             | QEMU `virt`, no KVM | AAVMF    | authoritative; boot-tested on linuxlt (container QEMU TCG, login in 141 s, zero failed units)                              |
| Raspberry Pi 4/5  | real hardware       | tryboot  | waits for owner hardware                                                                                                   |
| Bare metal x86-64 | real hardware       | UEFI     | waits for owner hardware                                                                                                   |

GPU coverage follows the add-on layer: the NVIDIA add-on carries the
open modules (Turing and newer) and the proprietary module (Pascal
and older) with MOK signing; AMD, Intel and Wi-Fi firmware ship in
the base image (`os/firmware/`). Driver behaviour on real GPUs is
proven on owner hardware; QEMU proves the boot, the setup flow and
the add-on merge.
