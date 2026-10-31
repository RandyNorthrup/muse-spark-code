"""Real test-only opener: validates the shim's argv/environment without HTTP."""

import os
import sys

assert sys.argv[1:] == ["http://127.0.0.1:41234/#k=test-launch"]
assert not any(
    name.upper().endswith("_API_KEY") or name.upper() == "OPENAI_KEY"
    for name in os.environ
)
