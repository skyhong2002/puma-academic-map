"""Normalize face size in already-published 256 px portraits (enlarge only, skip risky ones)."""
import json, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
import portrait_normalize as pn

MIN_RATIO = 0.26   # 放大超過約 1.7 倍會明顯變糊，維持原樣
folder = Path(__file__).resolve().parents[1] / "data" / "portraits"
stats = {"changed": 0, "already": 0, "too_small": [], "multi_face": [], "no_face": []}
for path in sorted(folder.glob("*.webp")):
    if path.name.startswith("enr-"):
        continue
    image = pn.read_image(str(path))
    import cv2
    h, w = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(pn.MODEL, "", (w, h), 0.7, 0.3, 5000)
    _, faces = detector.detect(image)
    if faces is None or not len(faces):
        stats["no_face"].append(path.name); continue
    if len(faces) > 1:
        stats["multi_face"].append(path.name); continue
    face = faces[0][:4].tolist()
    if face[2] / w < MIN_RATIO:
        stats["too_small"].append(path.name); continue
    if face[2] / w >= pn.FACE_RATIO - 0.01:
        stats["already"] += 1; continue
    left, top, side = pn.window_for(face, image.shape)
    result, _ = pn.render(image, left, top, side)
    cv2.imwrite(str(path), result, [cv2.IMWRITE_WEBP_QUALITY, 85])
    stats["changed"] += 1
print(json.dumps({k: (v if isinstance(v, int) else len(v)) for k, v in stats.items()}))
json.dump(stats, open("/tmp/normalize-existing.json", "w"), ensure_ascii=False)
