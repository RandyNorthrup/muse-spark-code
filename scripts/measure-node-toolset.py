#!/usr/bin/env python3
"""Measure docker-save layers without unpacking/executing their contents.

python3 scripts/measure-node-toolset.py <image.tar> <base|build> [budgets.json]
The base remains capped at 200 MB; build's separate measured budget is mandatory
for a release check. Without a budget file this command only measures.
"""
import gzip
import json
import pathlib
import sys
import tarfile

BASE_BUDGET_BYTES = 200_000_000
CHUNK_BYTES = 1024 * 1024


class ByteCounter:
    def __init__(self):
        self.bytes = 0

    def write(self, data):
        self.bytes += len(data)
        return len(data)


def measure_image(file):
    with tarfile.open(file, "r") as archive:
        source = archive.extractfile("manifest.json")
        if source is None:
            raise ValueError("Missing image manifest")
        manifest = json.load(source)
        if not isinstance(manifest, list) or len(manifest) != 1:
            raise ValueError("One image required")
        item = manifest[0]
        layers = item.get("Layers")
        if not isinstance(layers, list) or not layers or not all(isinstance(name, str) for name in layers):
            raise ValueError("Missing image layers")
        config = archive.extractfile(item["Config"])
        if config is None:
            raise ValueError("Missing image config")
        architecture = json.load(config).get("architecture")
        if architecture not in ("amd64", "arm64"):
            raise ValueError("Unsupported image architecture")
        measurements = []
        for name in layers:
            # Comparison uses POSIX separators on Windows too; nothing is extracted.
            normalized = name.replace("\\", "/")
            if normalized.startswith("/") or ".." in normalized.split("/"):
                raise ValueError("Unsafe image layer path")
            layer = archive.extractfile(normalized)
            if layer is None:
                raise ValueError("Missing image layer")
            first = layer.read(2)
            if first == b"\x1f\x8b":
                compressed = len(first)
                while chunk := layer.read(CHUNK_BYTES):
                    compressed += len(chunk)
            else:
                counter = ByteCounter()
                with gzip.GzipFile(filename="", mode="wb", fileobj=counter, mtime=0) as stream:
                    stream.write(first)
                    while chunk := layer.read(CHUNK_BYTES):
                        stream.write(chunk)
                compressed = counter.bytes
            measurements.append({"layer": normalized, "compressedBytes": compressed})
        return {"architecture": architecture, "layers": measurements, "compressedBytes": sum(row["compressedBytes"] for row in measurements)}


def check_budget(receipt, pack, budgets):
    if pack not in ("base", "build"):
        raise ValueError("Unknown image pack")
    # The caller cannot replace the existing base cap with a larger budget.
    budget = BASE_BUDGET_BYTES if pack == "base" else budgets["buildCompressedBytes"]
    if not isinstance(budget, int) or isinstance(budget, bool) or budget <= 0:
        raise ValueError("Invalid image budget")
    if receipt["compressedBytes"] > budget:
        raise ValueError("Toolset image exceeds compressed budget")
    return budget


def main():
    if len(sys.argv) not in (3, 4):
        raise ValueError("Usage: measure-node-toolset.py <image.tar> <base|build> [budgets.json]")
    receipt = measure_image(sys.argv[1])
    receipt["pack"] = sys.argv[2]
    if len(sys.argv) == 4:
        budgets = json.loads(pathlib.Path(sys.argv[3]).read_text())
        receipt["budgetBytes"] = check_budget(receipt, receipt["pack"], budgets)
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
