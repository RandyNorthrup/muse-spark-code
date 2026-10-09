"""Emit Zed's supported custom-agent and companion-task configuration."""

import argparse
import json
import sys
from pathlib import Path


def configuration(agent, python, agent_script=None):
    """Return authored Zed settings/tasks without writing user settings."""
    launcher = str(Path(__file__).with_name("launch.py").resolve())
    agent_args = [agent]
    if agent_script is not None:
        if not agent_script:
            raise ValueError("EPANEL_ARGUMENTS")
        agent_args.extend(["--agent-script", agent_script])
    return {
        "settings": {
            "agent_servers": {
                "Muse Spark Code (Unofficial)": {
                    "type": "custom",
                    "command": python,
                    "args": ["-I", launcher, "acp", *agent_args],
                    "env": {},
                }
            }
        },
        "tasks": [
            {
                "label": "Muse Spark Code (Unofficial): panel",
                "command": python,
                "args": ["-I", launcher, "panel", *agent_args],
                "allow_concurrent_runs": False,
                "use_new_terminal": True,
                "reveal": "never",
                "show_command": False,
                "show_summary": False,
                "save": "none",
            }
        ],
    }


def main():
    """Print configuration for the owner's explicit settings merge."""
    parser = argparse.ArgumentParser()
    parser.add_argument("--agent", default="muse-spark-code-acp")
    parser.add_argument("--python", default=sys.executable)
    parser.add_argument("--agent-script")
    args = parser.parse_args()
    print(
        json.dumps(configuration(args.agent, args.python, args.agent_script), indent=2)
    )


if __name__ == "__main__":
    main()
