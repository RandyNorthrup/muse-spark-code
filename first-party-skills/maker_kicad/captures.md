# Logic captures

Prefer an existing local sigrok capture; identify channel mapping, logic
voltage, sample rate and protocol before decoding. Capture first, decode
second: sigrok-cli is single-threaded. Choose a bounded sample/time count
for any later capture and a host process deadline.

A logic analyser connection is physical access: before connecting or sending
serial data, ask through the host's approval surface and confirm voltage
compatibility and a safe ground reference. Do not connect a grounded probe
to unknown mains circuitry. The user's safe circuit supply disconnect or
physical E-stop is the out-of-band stop; unplugging USB alone may leave the
circuit powered. Never power a load merely to obtain a trace.

Use the exact component datasheet for pin functions; PlatformIO board JSON
is not a pin map. Part APIs have their own authentication and licensing;
never put provider credentials into a command or commit.

[sigrok-cli](https://sigrok.org/wiki/Sigrok-cli),
[pinout reference](https://pinout.xyz/).
