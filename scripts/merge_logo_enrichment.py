"""Merge agent-collected institution logos (profile-collection/enrichment/logo-*.json) into data/emblems."""
import argparse, hashlib, json, re, subprocess, sys
from pathlib import Path

DATA = Path(__file__).resolve().parents[1] / "data" / "emblems"
URL = re.compile(r"^https://[^\s<>\"']+$")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("fragments", nargs="+", type=Path)
    args = parser.parse_args()
    index_path, alias_path = DATA / "enr-logos.json", DATA / "aliases.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    aliases = json.loads(alias_path.read_text())
    known = {name for path in DATA.glob("*.json") if path.name != "aliases.json" for name in json.loads(path.read_text())}
    tool = Path(__file__).with_name("make-logo.mjs")
    stats = {"logos": 0, "aliases": 0, "rejected": []}
    for fragment in args.fragments:
        for item in json.loads(fragment.read_text())["institutions"]:
            name = item["name"]
            target = item.get("alias_of")
            if target and target in known and name not in aliases:
                aliases[name] = target; stats["aliases"] += 1
                continue
            logo = item.get("logo")
            if not logo or name in known or name in index:
                continue
            if not URL.match(str(logo.get("source_url", ""))) or not logo.get("credit"):
                stats["rejected"].append(f"{name} 缺來源或署名"); continue
            file = "enr-logo-" + hashlib.md5(name.encode()).hexdigest()[:10] + ".webp"
            done = subprocess.run(["node", str(tool), logo["image_path"], str(DATA / file)], capture_output=True, text=True)
            if done.returncode:
                stats["rejected"].append(f"{name} 轉檔失敗：{done.stderr.strip()[-100:]}"); continue
            index[name] = {"file": file, "source_url": logo["source_url"], "credit": logo["credit"],
                           "usage": logo.get("usage") or "以原始圖形作非商業地理識別，保留原色彩和比例。"}
            if URL.match(str(logo.get("license_url", ""))): index[name]["license_url"] = logo["license_url"]
            stats["logos"] += 1
    index_path.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n")
    alias_path.write_text(json.dumps(aliases, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    sys.exit(main())
