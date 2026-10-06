# CNC/laser status and stop

This delivery allows status/settings reads, alarms and Stop only for CNC
and lasers. Do not propose or send motion, homing, probing, jogging, spindle
start, laser firing, resume or a job stream, even if a user could approve it.
The user runs jobs in CNCjs, UGS or FluidNC's own interface.

Serial connect still needs the host's approval surface: opening the port
may reset a controller. Read-only GRBL queries include ?, $$, $#, $G and $I;
reading over an already approved connection is different from opening one.
Unknown commands fail closed. Do not guess FluidNC ports or firmware alarms:
alarm 10 differs between GRBL 1.1 and grblHAL.

Stop machine sends GRBL's out-of-band !, then jog-cancel byte 0x85 and reset
byte 0x18; grblHAL has a firmware-specific 0x19 stop. Startup $N lines can
execute motion on reset: surface that warning and do not rewrite them.
Stop does not ask or wait behind streamed lines. The user's physical E-stop
for axes and spindle/laser is the emergency stop; a software stop is not an
emergency stop. Keep that physical control in reach during connection.

Do not send $X alarm unlock, $RST, $N writes or numeric $ setting writes.
Limits require known position, homing and soft limits; FluidNC soft_limits
is false by default. Do not assume limits are trustworthy just because a
configuration lists axis travel. $C check mode exists but leaving it resets
the controller; use offline simulation rather than toggling it on hardware.

[GRBL real-time commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands),
[GRBL configuration](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration),
[grblHAL commands](https://github.com/grblHAL/core/blob/master/grbl.h).
