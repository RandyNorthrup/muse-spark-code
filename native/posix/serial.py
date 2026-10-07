#!/usr/bin/env python3
"""Private serial/mutex helper. Binary data only on stdout, fixed status on stderr.

All bounds and line states are supplied by the portable engine after approval.
No credentials, shell, imports from the workspace, or device reads in Node.
"""

import argparse
import fcntl
import os
import select
import sys
import termios
import threading
import time

MILLISECONDS_PER_SECOND = 1000
OWNER_FILE_MODE = 0o600


def ready(word):
    sys.stderr.write(word + "\n")
    sys.stderr.flush()


def mutex(file):
    fd = os.open(file, os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, OWNER_FILE_MODE)
    try:
        while True:
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                # A dead parent must not leave a helper blocked behind another holder.
                if select.select([sys.stdin], [], [], 100 / MILLISECONDS_PER_SECOND)[0]:
                    if not os.read(sys.stdin.fileno(), 1):
                        return
        ready("lease-ready")
        while os.read(sys.stdin.fileno(), 1):
            pass
    finally:
        os.close(fd)


def serial(args):
    # Import is deliberately inside this mode: mutex and raw work without pyserial.
    import serial as pyserial

    port = pyserial.Serial()
    port.port = args.port
    port.baudrate = args.baud
    port.timeout = args.poll_ms / MILLISECONDS_PER_SECOND
    port.write_timeout = args.poll_ms / MILLISECONDS_PER_SECOND
    port.dtr = args.dtr == "1"
    port.rts = args.rts == "1"
    port.exclusive = True
    port.open()
    owns_exclusive = False
    try:
        fcntl.ioctl(port.fileno(), termios.TIOCEXCL)
        owns_exclusive = True
        transfer(args, lambda count: port.read(count), port.write)
    finally:
        try:
            if owns_exclusive:
                fcntl.ioctl(port.fileno(), termios.TIOCNXCL)
        finally:
            port.close()


def raw(args):
    # stty configured the line first, under the same host connect approval.
    fd = os.open(args.port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
    owns_exclusive = False
    try:
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.ioctl(fd, termios.TIOCEXCL)
        owns_exclusive = True

        def read(count):
            if select.select([fd], [], [], args.poll_ms / MILLISECONDS_PER_SECOND)[0]:
                return os.read(fd, count)
            return b""

        def write(data):
            sent = 0
            while sent < len(data):
                if not select.select([], [fd], [], args.poll_ms / MILLISECONDS_PER_SECOND)[1]:
                    raise TimeoutError()
                sent += os.write(fd, data[sent:])

        transfer(args, read, write)
    finally:
        try:
            if owns_exclusive:
                fcntl.ioctl(fd, termios.TIOCNXCL)
        finally:
            os.close(fd)


def transfer(args, read, write):
    stopped = threading.Event()
    failure = threading.Event()

    def input_bytes():
        total = 0
        try:
            while not stopped.is_set():
                data = os.read(sys.stdin.fileno(), args.chunk_bytes)
                if not data:
                    stopped.set()
                    return
                total += len(data)
                if total > args.max_bytes:
                    raise ValueError()
                write(data)
        except Exception:
            failure.set()
            stopped.set()

    threading.Thread(target=input_bytes, daemon=True).start()
    ready("serial-ready")
    deadline = time.monotonic() + args.duration_ms / MILLISECONDS_PER_SECOND
    remaining = args.max_bytes
    while remaining > 0 and not stopped.is_set() and time.monotonic() < deadline:
        data = read(min(args.chunk_bytes, remaining))
        if data:
            sys.stdout.buffer.write(data)
            sys.stdout.buffer.flush()
            remaining -= len(data)
    stopped.set()
    if failure.is_set():
        raise OSError()


def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="mode", required=True)
    lock = sub.add_parser("mutex")
    lock.add_argument("file")
    for mode in ("serial", "raw"):
        cmd = sub.add_parser(mode)
        cmd.add_argument("port")
        for name in ("baud", "duration_ms", "max_bytes", "chunk_bytes", "poll_ms"):
            cmd.add_argument(name, type=int)
        cmd.add_argument("dtr", choices=("0", "1"))
        cmd.add_argument("rts", choices=("0", "1"))
    args = parser.parse_args()
    try:
        if args.mode == "mutex":
            mutex(args.file)
        else:
            if min(args.baud, args.duration_ms, args.max_bytes, args.chunk_bytes, args.poll_ms) <= 0:
                raise ValueError()
            (serial if args.mode == "serial" else raw)(args)
        return 0
    except Exception:
        # Never echo OS exceptions: they can contain profile paths or payloads.
        ready("serial-unavailable")
        return 1


if __name__ == "__main__":
    sys.exit(main())
