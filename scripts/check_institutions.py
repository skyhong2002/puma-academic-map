"""Check institution data and summarize which roster rows have alias matches."""

import argparse
from collections import Counter
import json
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data"


def normalized(text):
    return "".join(text.split()).replace("臺", "台").casefold()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("query", nargs="?", help="Search the maintained institution list")
    parser.add_argument("--unmatched", action="store_true", help="List roster rows without an alias match")
    args = parser.parse_args()

    institutions = {}
    aliases = {}
    for path in sorted((DATA / "institutions").glob("*.json")):
        for institution in json.loads(path.read_text(encoding="utf-8")):
            name = institution["name"]
            if name in institutions:
                raise ValueError(f"重複機構：{name} ({path.name})")
            institutions[name] = institution
            for alias in {name, *institution["aliases"]}:
                key = normalized(alias)
                if not key or (key in aliases and aliases[key] != name):
                    raise ValueError(f"機構別名空白或重複：{alias} ({path.name})")
                aliases[key] = name

    if args.query:
        results = {
            name: institutions[name]
            for alias, name in aliases.items()
            if normalized(args.query) in alias
        }
        print(json.dumps(list(results.values()), ensure_ascii=False, indent=2))
        return

    snapshot = json.loads((DATA / "signatories.json").read_text(encoding="utf-8"))
    counts = Counter()
    for section, data in snapshot["sections"].items():
        matched = 0
        for row in data["entries"]:
            affiliation = normalized(row["affiliation_text"])
            candidates = {name for alias, name in aliases.items() if alias in affiliation}
            counts.update(candidates)
            matched += bool(candidates)
            if args.unmatched and not candidates:
                print(f"{section}  {row['raw']}")
        if args.unmatched:
            for row in data["unparsed"]:
                print(f"{section}  {row}")
        print(f"{section}：{matched}/{data['source_rows']} 筆有機構別名候選")
    for name, count in counts.most_common():
        print(f"{count:4}  {name}")


if __name__ == "__main__":
    main()
