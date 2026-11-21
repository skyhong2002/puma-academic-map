"""Import the public roster and retain the previous snapshot on failure."""

import argparse
from collections import Counter
from datetime import datetime, timezone
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import tempfile
from urllib.request import urlopen

SOURCE_URL = "https://sites.google.com/view/academic-kouenkai-for-puma/"
OUTPUT = Path(__file__).resolve().parents[1] / "data" / "signatories.json"
SECTIONS = ("共同領銜", "會員名單")
ENTRY = re.compile(r"(?P<name>[^（(]+?)[（(](?P<affiliation>.+)[）)]")
FOOTER = re.compile(r"總人數(?:突破|超過).*|登記表單[：:].*")


class Paragraphs(HTMLParser):
    def __init__(self):
        super().__init__()
        self.rows = []
        self.parts = None

    def handle_starttag(self, tag, attrs):
        if tag == "p":
            self.parts = []
        if tag == "br" and self.parts is not None:
            self.parts.append("\n")

    def handle_data(self, data):
        if self.parts is not None:
            self.parts.append(data)

    def handle_endtag(self, tag):
        if tag == "p" and self.parts is not None:
            self.rows.extend(line.strip() for line in "".join(self.parts).splitlines() if line.strip())
            self.parts = None


def parse(html, fetched_at):
    page = Paragraphs()
    page.feed(html)
    headings = {
        section: [index for index, row in enumerate(page.rows) if row.rstrip("：:") == section]
        for section in SECTIONS
    }
    if any(len(indices) != 1 for indices in headings.values()):
        raise ValueError("原站需要各有一個共同領銜與會員名單標題")
    leaders, members = (headings[section][0] for section in SECTIONS)
    end = next((i for i in range(members + 1, len(page.rows)) if FOOTER.fullmatch(page.rows[i])), None)
    if end is None or not leaders < members < end:
        raise ValueError("原站段落順序或頁尾已變更")
    sections = {}
    for section, rows in zip(SECTIONS, (page.rows[leaders + 1:members], page.rows[members + 1:end])):
        entries = []
        unresolved = []
        for row in rows:
            match = ENTRY.fullmatch(row)
            if match:
                entries.append({
                    "name": match["name"].strip(),
                    "affiliation_text": match["affiliation"].strip(),
                    "raw": row,
                })
            else:
                unresolved.append(row)
        if not entries:
            raise ValueError(f"{section}沒有可解析的記錄")
        sections[section] = {"source_rows": len(rows), "entries": entries, "unparsed": unresolved}
    return {"source_url": SOURCE_URL, "fetched_at": fetched_at, "sections": sections}


def contents(snapshot):
    return Counter(
        (section, row)
        for section, data in snapshot["sections"].items()
        for row in [*(entry["raw"] for entry in data["entries"]), *data["unparsed"]]
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--html", type=Path, help="Read a saved source page")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    if args.html is None:
        with urlopen(SOURCE_URL, timeout=30) as response:
            html = response.read().decode("utf-8")
        fetched_at = datetime.now(timezone.utc)
    else:
        html = args.html.read_text(encoding="utf-8")
        fetched_at = datetime.fromtimestamp(args.html.stat().st_mtime, timezone.utc)
    snapshot = parse(html, fetched_at.isoformat(timespec="seconds"))
    if args.output.exists():
        old = contents(json.loads(args.output.read_text(encoding="utf-8")))
        new = contents(snapshot)
        for label, changes in (("新增", new - old), ("移除", old - new)):
            print(f"{label} {changes.total()} 筆")
            for (section, raw), count in changes.items():
                print(f"  {section} ×{count} {raw}")
        if old == new:
            print("名單未變更，保留現有快照")
            return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        mode="w", encoding="utf-8", dir=args.output.parent, delete=False
    ) as output:
        json.dump(snapshot, output, ensure_ascii=False, indent=2)
        output.write("\n")
    Path(output.name).replace(args.output)
    args.output.chmod(0o644)
    for section, data in snapshot["sections"].items():
        print(f"{section} {data['source_rows']} 筆，已解析 {len(data['entries'])} 筆，待核對 {len(data['unparsed'])} 筆")


if __name__ == "__main__":
    main()
