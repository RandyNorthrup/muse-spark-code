#!/bin/sh
# Runs as guest PID 1 only, never on the host.
export PATH=/usr/sbin:/usr/bin:/sbin:/bin
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t devtmpfs devtmpfs /dev
stty -F /dev/console 115200 clocal -crtscts raw echo
exec </dev/console >/dev/console 2>&1
mount -t configfs none /sys/kernel/config
modprobe gpio-sim || modprobe gpio-mockup gpio_mockup_ranges=0,8
if [ -d /sys/kernel/config/gpio-sim ]; then
 mkdir -p /sys/kernel/config/gpio-sim/muse/gpio-bank0
 printf '8' > /sys/kernel/config/gpio-sim/muse/gpio-bank0/num_lines
 printf 'muse-emulator' > /sys/kernel/config/gpio-sim/muse/gpio-bank0/label
 printf '1' > /sys/kernel/config/gpio-sim/muse/live
fi
printf '\nMUSE_EMULATOR_READY\n'
cat /proc/device-tree/model
printf '\n'
gpioinfo || true
exec setsid --wait /sbin/agetty --autologin root --login-program /bin/sh --login-options=-i --noclear --noissue --local-line ttyAMA0 115200 linux
