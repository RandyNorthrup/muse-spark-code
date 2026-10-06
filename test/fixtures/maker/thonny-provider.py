"""The real v2 plugin over loopback, with displayed context and a fake port owner."""
import json
import pathlib
import sys
import threading
import time

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[3] / "integrations/thonny/src"))
from thonnycontrib.muse_spark.bridge import ProviderClient
from thonnycontrib.muse_spark.runner import BridgeEngine

endpoint = json.loads(sys.stdin.readline())
frames = []
read = threading.Event()
done = threading.Event()


class DisplayedContext:
    def is_available(self):
        return True

    def console_text(self):
        read.set()
        return "fake shell ready\n"


class CapturedProvider(ProviderClient):
    def _send(self, frame):
        self_frame = dict(frame)
        if "token" in self_frame:
            self_frame["token"] = "[private-launch-capability]"
        frames.append({"direction": "thonny-to-runtime", "frame": self_frame})
        super()._send(frame)

    def _read_frame(self):
        frame = super()._read_frame()
        frames.append({"direction": "runtime-to-thonny", "frame": frame})
        return frame


engine = BridgeEngine(DisplayedContext())
client = CapturedProvider(endpoint["host"], endpoint["port"], endpoint["token"], engine)


def progress():
    while not done.wait(0.01):
        engine.progress()


client.connect()
worker = client.start_thread()
ui = threading.Thread(target=progress)
ui.start()
try:
    client.change_port("acquire", "COM7")
    client.change_port("release", "COM7")
    print("READY", flush=True)
    if not read.wait(10):
        raise RuntimeError("context request missing")
    time.sleep(0.1)
finally:
    done.set()
    client.close()
    ui.join()
    worker.join()
print(json.dumps(frames), flush=True)
