"""Add person-level sources from the Ministry of Education's official faculty rosters."""

from collections import defaultdict
import csv
import json
from pathlib import Path
import re
import sys

DATA = Path(__file__).resolve().parents[1] / "data"
SOURCES = {
    "114": ("https://udb.moe.edu.tw/ulist/Resource/download/ulist_teacher?extension=csv", "2025-10-15 調查"),
    "108": ("https://ws.moe.edu.tw/001/Upload/4/relfile/0/5039/83b46b95-b029-4fc3-8863-8b6c125e10d9.csv", "2019–2020 學年度歷史資料"),
}


def normalize(value):
    return re.sub(r"\s+", "", value).replace("台", "臺")


UNIT_ABBREVIATIONS = {
    "外國語文系": "外文系",
    "電機工程系": "電機系",
    "資訊工程系": "資工系",
    "資訊管理系": "資管系",
    "企業管理系": "企管系",
    "財務金融系": "財金系",
    "土木工程系": "土木系",
    "機械工程系": "機械系",
    "電子工程系": "電子系",
    "中國文系": "中文系",
    "臺灣文系": "臺文系",
    "臺灣史所": "臺史所",
}


def unit_key(value):
    text = normalize(value).replace("學系", "系").replace("研究所", "所")
    for full, abbreviation in UNIT_ABBREVIATIONS.items():
        if text.startswith(full):
            return abbreviation + text[len(full):]
    return text


def main(csv_path, year):
    url, period = SOURCES[year]
    label = f"教育部 {year} 學年度師資名錄"
    schools = defaultdict(set)
    records = defaultdict(set)
    with open(csv_path, encoding="utf-8-sig", newline="") as source:
        reader = csv.reader(source)
        header = next(reader)
        if year == "114":
            if "114學年度大專校院教師學術專長彙整表" not in header[0]:
                raise ValueError("需要教育部 114 學年度師資 CSV")
            next(reader)
            header = next(reader)
        fields = ("學校名稱", "系所名稱" if year == "114" else "單位名稱", "專兼任", "聘書職級", "教師名稱")
        indexes = [list(map(normalize, header)).index(field) for field in fields]
        for row in reader:
            if len(row) != len(header):
                continue
            school, unit, employment, title, name = (row[i].strip() for i in indexes)
            if not all((school, unit, name)):
                continue
            school_key = normalize(school)
            public_name = school_key.split("財團法人")[-1]
            schools[school_key].update((school_key, public_name, re.sub(r"^(國立|市立)", "", public_name)))
            records[normalize(name)].add((school, unit, employment, title))
    for path in (DATA / "institutions").glob("*.json"):
        for institution in json.loads(path.read_text()):
            key = normalize(institution["name"])
            if key in schools:
                schools[key].update(normalize(alias) for alias in institution["aliases"])

    roster = json.loads((DATA / "signatories.json").read_text())
    path = DATA / "affiliation-sources.json"
    sources = json.loads(path.read_text())
    matched = 0
    for section, group in roster["sections"].items():
        result = sources.setdefault(section, {})
        for entry in group["entries"]:
            raw = entry["raw"]
            claims = normalize(entry["affiliation_text"])
            fragments = [re.sub(r"^(?:曾任|前)", "", fragment) for fragment in re.split(r"[、，,；;／/]", claims)]
            person_records = sorted(records[normalize(entry["name"])])
            matches = []
            institutions = set()
            for school, unit, employment, title in person_records:
                aliases = schools[normalize(school)]
                # Require a school alias adjacent to its unit within the same claim.
                remainders = [
                    fragment[len(alias):]
                    for fragment in fragments
                    for alias in aliases
                    if alias and fragment.startswith(alias)
                ]
                exact_unit = any(unit_key(tail).startswith(unit_key(unit)) for tail in remainders)
                # When the signer only lists school and rank, require one
                # unique school/rank record and an exact rank or appointment.
                same_rank = sum(row[0] == school and row[3] == title for row in person_records)
                school_and_rank = title and same_rank == 1 and any(
                    tail in {title, employment + title} for tail in remainders
                )
                if not (exact_unit or (year == "114" and school_and_rank)):
                    continue
                matches.append(f"{school}{unit}，{employment}{title}")
                institutions.add(normalize(school).split("財團法人")[-1])
            existing = [ref for ref in result.get(raw, []) if ref["label"] != label]
            if matches and (year == "114" or not existing):
                existing.append({
                    "label": label,
                    "description": f"教育部彙整表（{period}）記載：{'；'.join(dict.fromkeys(matches))}。",
                    "url": url,
                    "institutions": sorted(institutions),
                })
                matched += 1
            if existing:
                result[raw] = existing
            else:
                result.pop(raw, None)
    path.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n")
    print(f"教育部來源比對成功 {matched} 筆")


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3) or (len(sys.argv) == 3 and sys.argv[2] not in SOURCES):
        raise SystemExit("用法：python3 scripts/import_moe_affiliations.py 師資名錄.csv [114|108]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else "114")
