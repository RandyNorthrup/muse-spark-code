"""Compile this plugin's singular gettext PO catalogues using only stdlib."""

import ast
from pathlib import Path
import struct


def compile_catalogue(path):
    entries = {}
    msgid = msgstr = None
    active = None
    for line in path.read_text(encoding="utf-8").splitlines() + [""]:
        line = line.strip()
        if line.startswith("#"):
            continue
        if not line:
            if msgid is not None:
                if msgstr is None or msgid in entries:
                    raise ValueError("missing or duplicate translation in " + str(path))
                entries[msgid] = msgstr
            msgid = msgstr = active = None
        elif line.startswith("msgid "):
            msgid, active = ast.literal_eval(line[len("msgid "):]), "id"
        elif line.startswith("msgstr "):
            msgstr, active = ast.literal_eval(line[len("msgstr "):]), "str"
        elif line.startswith('"') and active:
            if active == "id":
                msgid += ast.literal_eval(line)
            else:
                msgstr += ast.literal_eval(line)
        else:
            raise ValueError("unsupported PO line in " + str(path))
    keys = sorted(entries)
    ids = [key.encode("utf-8") for key in keys]
    values = [entries[key].encode("utf-8") for key in keys]
    count = len(keys)
    header_size, entry_size = 28, 8
    id_table = header_size
    value_table = id_table + count * entry_size
    offset = value_table + count * entry_size
    index = []
    for value in ids + values:
        index.append((len(value), offset))
        offset += len(value) + 1
    header = struct.pack("<7I", 0x950412DE, 0, count, id_table, value_table, 0, 0)
    tables = b"".join(struct.pack("<2I", *row) for row in index)
    payload = b"".join(value + b"\0" for value in ids + values)
    path.with_suffix(".mo").write_bytes(header + tables + payload)


if __name__ == "__main__":
    paths = sorted((Path(__file__).resolve().parents[1] / "src/thonnycontrib/muse_spark/locale").glob("*/LC_MESSAGES/muse_spark.po"))
    for path in paths:
        compile_catalogue(path)
    print("Compiled", len(paths), "gettext catalogues")
