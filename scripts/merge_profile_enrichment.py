"""Validate agent-collected enrichment fragments and merge them into site data.

Fragment format (profile-collection/enrichment/*.json):
{"people": [{
  "section": "會員名單", "raw": "<署名原文>",
  "research": {"keywords": [{"label": "...", "source": "https://..."}], "scholar": "https://..."},
  "portrait": {"image_path": "/tmp/x.jpg", "crop": [l, t, w, h] | null,
               "source_url": "https://頁面", "credit": "..."},
  "sources": [{"label": "...", "description": "...", "url": "https://...", "institutions": ["..."]}]
}]}
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
URL = re.compile(r"^https://[^\s<>\"']+$")
EMAIL = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def clean_keywords(items):
    seen, keywords = set(), []
    for item in items or []:
        label = re.sub(r"\s+", " ", str(item.get("label", ""))).strip()
        source = str(item.get("source", "")).strip()
        if not 2 <= len(label) <= 60 or EMAIL.search(label) or not URL.match(source):
            continue
        if label.casefold() in seen:
            continue
        seen.add(label.casefold())
        keywords.append({"label": label, "source": source})
    return keywords[:8]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("fragments", nargs="+", type=Path)
    parser.add_argument("--tag", required=True, help="本次合併的英數代號，用於頭像索引檔名")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    if not re.fullmatch(r"[a-z0-9-]+", args.tag):
        parser.error("--tag 只能含小寫英數與連字號")

    people = {
        (section, entry["raw"])
        for section, group in read(DATA / "signatories.json")["sections"].items()
        for entry in group["entries"]
    }
    research_path = DATA / "person-research.json"
    research = read(research_path)
    by_key = {(record["section"], record["raw"]): record for record in research}
    portrait_files = list((DATA / "portraits").glob("*.json"))
    has_portrait = {
        (section, raw)
        for path in portrait_files for section, group in read(path).items() for raw in group
    }
    index_path = DATA / "portraits" / f"enr-{args.tag}.json"
    index = read(index_path) if index_path.exists() else {}
    source_path = DATA / "research" / f"enr-{args.tag}.json"
    source_records = read(source_path) if source_path.exists() else []
    tool = Path(__file__).with_name("make-portrait.mjs")
    stats = {"research_new": 0, "research_extended": 0, "portraits": 0, "sources": 0, "rejected": []}

    for fragment in args.fragments:
        for person in read(fragment)["people"]:
            key = (person.get("section"), person.get("raw"))
            label = f"{fragment.name}:{key[1]}"
            if key not in people:
                stats["rejected"].append(f"{label} 不在名單")
                continue

            keywords = clean_keywords((person.get("research") or {}).get("keywords"))
            scholar = (person.get("research") or {}).get("scholar")
            if keywords:
                record = by_key.get(key)
                if record is None:
                    digest = hashlib.md5(json.dumps(key, ensure_ascii=False).encode()).hexdigest()
                    record = {"id": digest, "section": key[0], "raw": key[1], "keywords": []}
                    research.append(record)
                    by_key[key] = record
                    stats["research_new"] += 1
                else:
                    stats["research_extended"] += 1
                known = {item["label"].casefold() for item in record["keywords"]}
                record["keywords"] += [item for item in keywords if item["label"].casefold() not in known]
                record["keywords"] = record["keywords"][:12]
                if scholar and URL.match(scholar) and "scholar.google" in scholar:
                    record.setdefault("scholar", scholar)

            refs = [
                {k: ref[k] for k in ("label", "description", "url", "institutions") if k in ref}
                for ref in person.get("sources") or [] if URL.match(str(ref.get("url", "")))
                and ref.get("label") and ref.get("description")
            ]
            seen_urls = {ref["url"] for record in source_records
                         if (record["section"], record["raw"]) == key for ref in record["sources"]}
            refs = [ref for ref in refs if ref["url"] not in seen_urls]
            if refs:
                source_records.append({"section": key[0], "raw": key[1], "sources": refs})
                stats["sources"] += 1

            portrait = person.get("portrait")
            if portrait and key not in has_portrait:
                if not URL.match(str(portrait.get("source_url", ""))) or not portrait.get("credit"):
                    stats["rejected"].append(f"{label} 頭像缺來源或署名")
                    continue
                name = "enr-" + hashlib.md5(json.dumps(key, ensure_ascii=False).encode()).hexdigest()[:12] + ".webp"
                crop = portrait.get("crop")
                command = ["node", str(tool), portrait["image_path"], str(DATA / "portraits" / name)]
                if crop:
                    command.append(",".join(map(str, crop)))
                if not args.dry_run:
                    done = subprocess.run(command, capture_output=True, text=True)
                    if done.returncode:
                        stats["rejected"].append(f"{label} 頭像轉檔失敗：{done.stderr.strip()[:120]}")
                        continue
                index.setdefault(key[0], {})[key[1]] = {
                    "file": name, "credit": portrait["credit"], "source_url": portrait["source_url"],
                }
                has_portrait.add(key)
                stats["portraits"] += 1

    if not args.dry_run:
        write(research_path, research)
        if index:
            write(index_path, index)
        if source_records:
            write(source_path, source_records)
    print(json.dumps(stats, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    sys.exit(main())
