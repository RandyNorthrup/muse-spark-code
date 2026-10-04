#!/usr/bin/env python3
"""Apply an explicit native-plan candidate with atomic replacement and conflict checks."""

import sys

from delivery.writer import run


def main() -> int:
    """Print the update receipt and propagate conflict or input errors."""
    code, output = run()
    print(output)
    return code


if __name__ == "__main__":
    sys.exit(main())
