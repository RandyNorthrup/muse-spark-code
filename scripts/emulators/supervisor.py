#!/usr/bin/env python3
"""Private, bounded Linux emulator processes and socat UARTs; no hardware opens."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import signal
import stat
import subprocess
import sys
import time

START_SECONDS = 10
STOP_SECONDS = 5
POLL_SECONDS = 0.05
RUN_SECONDS = 600


def stamp(pid):
    try:
        fields = Path(f'/proc/{pid}/stat').read_text().rsplit(')', 1)[1].split()
        return None if fields[0] == 'Z' else fields[19]
    except FileNotFoundError:
        return None


def record(directory):
    try:
        data = json.loads((directory / 'run.json').read_text())
        if (type(data.get('pid')) is not int or data['pid'] <= 1
                or not isinstance(data.get('stamp'), str)):
            raise ValueError('invalid supervisor record')
        return data if stamp(data['pid']) == data.get('stamp') else None
    except FileNotFoundError:
        return None


def private(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    info = directory.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise ValueError('emulator directory must be private and owned by this user')


def serve(directory, board, command):
    stopping = False
    children = []
    def stop(_signum, _frame):
        nonlocal stopping
        stopping = True
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    env = {'PATH': os.defpath, 'LANG': 'C.UTF-8'}
    port = directory / f'ttyEMU-{board}-0'
    uart = directory / 'uart'
    try:
        for link in (port, uart):
            link.unlink(missing_ok=True)
        with (directory / 'socat.log').open('wb') as log:
            children.append(subprocess.Popen([
                'socat', '-d', '-d', f'pty,raw,echo=0,link={port}',
                f'pty,raw,echo=0,link={uart}',
            ], env=env, stdout=log, stderr=log, start_new_session=True))
        deadline = time.monotonic() + START_SECONDS
        while not (port.exists() and uart.exists()):
            if stopping or children[0].poll() is not None or time.monotonic() > deadline:
                raise RuntimeError('socat UART startup failed')
            time.sleep(POLL_SECONDS)
        with (directory / 'emulator.log').open('wb') as log:
            children.append(subprocess.Popen(command, env=env, stdin=subprocess.DEVNULL,
                stdout=log, stderr=log, start_new_session=True))
        time.sleep(POLL_SECONDS * 2)
        if children[-1].poll() is not None:
            raise RuntimeError('emulator startup failed; see emulator.log')
        data = {'pid': os.getpid(), 'stamp': stamp(os.getpid()), 'port': str(port),
                'board': board, 'children': [c.pid for c in children]}
        temporary = directory / 'run.json.tmp'
        temporary.write_text(json.dumps(data))
        temporary.replace(directory / 'run.json')
        deadline = time.monotonic() + RUN_SECONDS
        while not stopping and time.monotonic() < deadline:
            if any(child.poll() is not None for child in children):
                raise RuntimeError('emulator or UART exited; see logs')
            time.sleep(POLL_SECONDS)
    finally:
        for child in reversed(children):
            try:
                os.killpg(child.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        deadline = time.monotonic() + STOP_SECONDS
        for child in reversed(children):
            try:
                child.wait(timeout=max(POLL_SECONDS, deadline - time.monotonic()))
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait(timeout=STOP_SECONDS)
        for file in ('run.json', 'run.json.tmp', 'uart', 'renode-uart', 'qemu-uart', port.name):
            (directory / file).unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['start', 'stop', 'status', 'serve'])
    parser.add_argument('board')
    parser.add_argument('directory', type=Path)
    parser.add_argument('command', nargs=argparse.REMAINDER)
    args = parser.parse_args()
    directory = args.directory.absolute()
    private(directory)
    if args.action == 'serve':
        serve(directory, args.board, args.command)
        return
    with (directory / 'control.lock').open('a') as lock:
        deadline = time.monotonic() + START_SECONDS
        while True:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                break
            except BlockingIOError:
                if time.monotonic() > deadline:
                    raise RuntimeError('emulator control lock deadline exceeded')
                time.sleep(POLL_SECONDS)
        data = record(directory)
        if args.action == 'stop':
            if data is not None:
                os.kill(data['pid'], signal.SIGTERM)
                deadline = time.monotonic() + STOP_SECONDS * 2
                while record(directory) is not None:
                    if time.monotonic() > deadline:
                        raise RuntimeError('emulator Stop deadline exceeded')
                    time.sleep(POLL_SECONDS)
            print(json.dumps({'status': 'stopped'}))
            return
        if args.action == 'status':
            print(json.dumps(data or {'status': 'stopped'}))
            return
        if not args.command:
            raise ValueError('start needs an emulator command')
        if data is None:
            with (directory / 'supervisor.log').open('wb') as log:
                child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()),
                    'serve', args.board, str(directory), *args.command],
                    env={'PATH': os.defpath, 'LANG': 'C.UTF-8'}, stdin=subprocess.DEVNULL,
                    stdout=log, stderr=log, start_new_session=True)
            deadline = time.monotonic() + START_SECONDS
            while data is None:
                if child.poll() is not None:
                    raise RuntimeError('emulator startup failed; see supervisor.log')
                if time.monotonic() > deadline:
                    child.terminate()
                    child.wait(timeout=STOP_SECONDS * 2)
                    raise RuntimeError('emulator startup deadline exceeded')
                time.sleep(POLL_SECONDS)
                data = record(directory)
        print(json.dumps(data))


if __name__ == '__main__':
    main()
