#!/usr/bin/env python3
"""Rebuild pinned WOFF2 subsets from locally supplied official release archives.
Requires fonttools[woff] 4.60.1 and brotli 1.1.0. Never downloads anything.
"""
import argparse
import hashlib
import io
import json
from pathlib import Path
import zipfile

from fontTools import subset
from fontTools.ttLib import TTFont


def digest(data):
    return hashlib.sha256(data).hexdigest()


def checked(data, expected):
    if digest(data) != expected:
        raise ValueError("Source digest mismatch")
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_directory", type=Path)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    sources = json.loads(Path(__file__).with_name("sources.json").read_text())
    args.out.mkdir(parents=True, exist_ok=True)
    ranges = []
    for item in sources["unicodeRange"].split(","):
        parts = item[2:].split("-")
        low = int(parts[0], 16)
        high = int(parts[-1], 16)
        ranges.extend(range(low, high + 1))
    results = []
    for source in sources["fonts"]:
        archive = checked((args.source_directory / source["archive"]).read_bytes(), source["archiveSha256"])
        with zipfile.ZipFile(io.BytesIO(archive)) as release:
            font_bytes = checked(release.read(source["member"]), source["memberSha256"])
            notice = release.read(source["noticeMember"]) if "noticeMember" in source else (args.source_directory / source["noticeSeed"]).read_bytes()
        checked(notice, source["noticeSha256"])
        font = TTFont(io.BytesIO(font_bytes), recalcTimestamp=False)
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_languages = ["*"]
        options.name_legacy = True
        subsetter = subset.Subsetter(options=options)
        subsetter.populate(unicodes=ranges)
        subsetter.subset(font)
        # Subsets are modified fonts. Give them distinct names, preserving copyright/licence names.
        family = source["cssFamily"]
        postscript = family.replace(" ", "")
        names = {1: family, 2: "Regular", 3: postscript + "-" + source["tag"] + "-subset", 4: family + " Regular", 6: postscript + "-Regular", 16: family, 17: "Regular", 25: postscript}
        for record in font["name"].names:
            if record.nameID in names:
                record.string = names[record.nameID].encode(record.getEncoding())
        if "fvar" in font:
            for i, instance in enumerate(font["fvar"].instances):
                name_id = instance.postscriptNameID
                if name_id != 0xFFFF:
                    for record in font["name"].names:
                        if record.nameID == name_id:
                            record.string = (postscript + "-Instance" + str(i)).encode(record.getEncoding())
        font.flavor = "woff2"
        output = io.BytesIO()
        font.save(output)
        data = output.getvalue()
        (args.out / source["fontFile"]).write_bytes(data)
        (args.out / source["noticeFile"]).write_bytes(notice)
        results.append({"font": source["fontFile"], "bytes": len(data), "sha256": digest(data), "notice": source["noticeFile"], "noticeBytes": len(notice), "noticeSha256": digest(notice)})
    print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
