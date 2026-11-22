"""Collect review candidates without modifying the website's published data."""

import argparse
from bisect import bisect_right
from collections import defaultdict
import csv
from datetime import datetime, timezone
import io
import json
from pathlib import Path
import re
from urllib.parse import urlencode, urlsplit
from urllib.request import Request, urlopen

from import_moe_affiliations import SOURCES, normalize, unit_key


DATA = Path(__file__).resolve().parents[1] / "data"
MOE_URL, MOE_PERIOD = SOURCES["114"]
COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "PumaAcademicProfiles/1.0 (https://github.com/skyhong2002/puma-academic-map)"


def read_json(path):
    return json.loads(path.read_text(encoding="utf-8"))


def fetch(url, limit):
    with urlopen(Request(url, headers={"User-Agent": USER_AGENT}), timeout=45) as response:
        content = response.read(limit + 1)
    if len(content) > limit:
        raise ValueError(f"來源回應超出大小上限：{urlsplit(url).hostname}")
    return content


def person_key(record):
    return record["section"], record["raw"]


def inventory(data):
    entries = {
        (section, entry["raw"]): {**entry, "section": section}
        for section, group in read_json(data / "signatories.json")["sections"].items()
        for entry in group["entries"]
    }
    photos = set()
    for path in sorted((data / "portraits").glob("*.json")):
        for section, group in read_json(path).items():
            for raw, photo in group.items():
                filename = photo.get("file", "")
                local = filename.endswith(".webp") and Path(filename).name == filename
                if (local and (path.parent / filename).is_file()) or photo.get("image_url", "").startswith("https://"):
                    photos.add((section, raw))

    topics, links = defaultdict(set), defaultdict(set)
    for record in read_json(data / "person-research.json"):
        key = person_key(record)
        for keyword in record.get("keywords", []):
            topics[key].add(normalize(keyword["label"]).casefold())
            if keyword.get("source"):
                links[key].add(keyword["source"])

    affiliations = defaultdict(set)
    for section, group in read_json(data / "affiliation-sources.json").items():
        for raw, references in group.items():
            affiliations[section, raw].update(ref["url"] for ref in references if ref.get("url"))
    for path in sorted((data / "research").glob("*.json")):
        for record in read_json(path):
            affiliations[person_key(record)].update(ref["url"] for ref in record.get("sources", []) if ref.get("url"))

    for key, entry in entries.items():
        refs = {url for url in affiliations[key] if url.startswith(("https://", "http://"))}
        entry["missing"] = [field for field, found in (
            ("portrait", key in photos), ("research", topics[key]), ("affiliation", refs),
        ) if not found]
        entry["reference_urls"] = sorted(refs | links[key])[:8]
    return sorted(entries.values(), key=queue_key), topics


def queue_key(entry):
    return (-len(entry["missing"]), *person_key(entry))


def next_batch(entries, cursor, size):
    start = bisect_right([queue_key(entry) for entry in entries], tuple(cursor)) if cursor else 0
    return (entries[start:] + entries[:start])[:size]


def faculty_index(content, data, names):
    rows = csv.reader(io.StringIO(content.decode("utf-8-sig"), newline=""))
    first = next(rows, [])
    if not first or "114學年度大專校院教師學術專長彙整表" not in first[0]:
        raise ValueError("來源不是教育部 114 學年度師資 CSV；請檢查資料版本")
    next(rows, None)
    header = list(map(normalize, next(rows, [])))
    fields = ("教師名稱", "學校名稱", "系所名稱", "聘書職級", "專兼任", "教師專長", "系所網址")
    columns = [header.index(field) for field in fields]
    aliases = defaultdict(set)
    for path in sorted((data / "institutions").glob("*.json")):
        for school in read_json(path):
            aliases[normalize(school["name"])].update(normalize(alias) for alias in school["aliases"])
    faculty = defaultdict(set)
    for row in rows:
        if len(row) != len(header):
            continue
        name, school, unit, title, appointment, research, department_url = (row[index].strip() for index in columns)
        if normalize(name) in names and school and unit:
            faculty[normalize(name)].add((school, unit, title, appointment, research, department_url))
    return faculty, aliases


def faculty_candidate(entry, faculty, aliases, existing_topics):
    claims = re.split(r"[、，,；;／/]", normalize(entry["affiliation_text"]))
    matches = []
    for row in sorted(faculty[normalize(entry["name"])]):
        school, unit, title, appointment, _, _ = row
        school_key = normalize(school)
        public_name = school_key.split("財團法人")[-1]
        school_names = {school_key, public_name, re.sub(r"^(國立|市立)", "", public_name)} | aliases[school_key]
        unit_name = unit_key(unit)
        suffixes = {unit_name, unit_name + normalize(title), unit_name + normalize(appointment + title)}
        if any(unit_key(claim[len(alias):]) in suffixes
               for claim in claims for alias in school_names if alias and claim.startswith(alias)):
            matches.append(row)
    if len(matches) != 1:
        return None, "ambiguous" if matches else "no_exact_match"

    school, unit, title, appointment, research, department_url = matches[0]
    keywords = list(dict.fromkeys(
        term for part in re.split(r"[、；;\n]", research) if (term := part.strip())
        and term not in {"-", "—", "無", "未填"} and normalize(term).casefold() not in existing_topics
    ))
    candidate = {
        "source_url": MOE_URL, "source_period": MOE_PERIOD, "school": school, "department": unit,
        "title": title, "appointment": appointment, "new_research_keywords": keywords,
    }
    if department_url.startswith(("https://", "http://")):
        candidate["department_url"] = department_url
    return candidate, "candidate"


def commons_candidates(name):
    names = [part.strip() for part in re.split(r"[（()）]", name) if part.strip()]
    query = " OR ".join(f'"{part.replace(chr(34), "")}"' for part in names)
    params = {
        "action": "query", "format": "json", "formatversion": 2, "generator": "search",
        "gsrnamespace": 6, "gsrlimit": 4, "gsrsearch": query, "prop": "imageinfo",
        "iiprop": "url|mime|extmetadata", "iiextmetadatafilter": "LicenseShortName|LicenseUrl",
        "maxlag": 5,
    }
    result = json.loads(fetch(f"{COMMONS_API}?{urlencode(params)}", 1_000_000))
    if "error" in result:
        raise ValueError(f'Wikimedia Commons API：{result["error"]["code"]}')
    candidates = []
    for page in sorted(result.get("query", {}).get("pages", []), key=lambda page: page.get("index", 0)):
        for image in page.get("imageinfo", []):
            if image.get("mime") not in {"image/jpeg", "image/png", "image/webp"}:
                continue
            metadata = image.get("extmetadata", {})
            candidates.append({
                "title": page["title"], "source_url": image["descriptionurl"],
                "claimed_license": metadata.get("LicenseShortName", {}).get("value"),
                "license_url": metadata.get("LicenseUrl", {}).get("value"),
            })
    return candidates


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--inventory", action="store_true", help="只列出缺漏，不連網")
    parser.add_argument("--output", type=Path, help="專門儲存候選資料的目錄")
    parser.add_argument("--run-id", default=datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"))
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--moe-csv", type=Path, help="使用已下載的 114 學年度 CSV")
    args = parser.parse_args()
    entries, topics = inventory(DATA)
    if args.inventory:
        print(json.dumps([{key: entry[key] for key in ("section", "raw", "missing")} for entry in entries], ensure_ascii=False, indent=2))
        return
    if not args.output or not 1 <= args.limit <= 50 or not re.fullmatch(r"[a-zA-Z0-9_-]+", args.run_id):
        parser.error("需要 --output、1–50 的 --limit，以及只含英數字、連字號或底線的 --run-id")
    if not entries:
        raise ValueError("名單為空，取消收集")

    state = args.output / "state.json"
    run = args.output / "runs" / f"{args.run_id}.json"
    if run.exists():
        raise ValueError(f"批次已存在：{run.name}")
    batch = next_batch(entries, read_json(state)["cursor"] if state.exists() else None, args.limit)
    content = args.moe_csv.read_bytes() if args.moe_csv else fetch(MOE_URL, 40_000_000)
    faculty, aliases = faculty_index(content, DATA, {normalize(entry["name"]) for entry in batch})
    results = []
    for entry in batch:
        candidate, status = faculty_candidate(entry, faculty, aliases, topics[person_key(entry)])
        portraits = commons_candidates(entry["name"]) if "portrait" in entry["missing"] else []
        results.append({
            **{key: entry[key] for key in ("section", "raw", "missing", "reference_urls")},
            "faculty_status": status, "faculty_candidate": candidate, "portrait_candidates": portraits,
        })
    run.parent.mkdir(parents=True, exist_ok=True)
    write_json(run, {"schema_version": 1, "review_status": "pending", "checked_at": datetime.now(timezone.utc).isoformat(), "people": results})
    write_json(state, {"cursor": queue_key(batch[-1])})
    print(f"已整理 {len(results)} 筆待審紀錄：{run.name}")


if __name__ == "__main__":
    main()
