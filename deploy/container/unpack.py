"""Extract only regular files, never archive links, devices or outside paths.

Used for OCI blobs and independently for every original image layer. Deleted
files therefore still reach the secret scanner. No archive entry is executed.
"""

import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

policy = json.loads((Path(__file__).parent / "policy.json").read_text())
archive, destination = sys.argv[1:]
root = Path(destination)
root.mkdir()
total = 0
count = 0
with tarfile.open(archive, "r:*") as source:
    for member in source:
        name = PurePosixPath(member.name)
        if name.is_absolute() or ".." in name.parts:
            raise ValueError("Unsafe archive member path")
        if not member.isfile():
            continue
        total += member.size
        count += 1
        if total > policy["maxExtractedBytes"] or count > policy["maxExtractedFiles"]:
            raise ValueError("Archive extraction limit exceeded")
        target = root.joinpath(*name.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.extractfile(member) as data, target.open("xb") as output:
            while chunk := data.read(1024 * 1024):
                output.write(chunk)
