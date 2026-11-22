"""Crop a portrait so every face has the same size and position in a 256 x 256 WebP.

Needs opencv-python-headless, numpy and the YuNet model (face_detection_yunet_2023mar.onnx);
run it with the interpreter that has them (see docs/professor-profile-collection.md).

  portrait_normalize.py <in> <out.webp> [--crop l,t,w,h] [--model path]

The detected face box is scaled to FACE_RATIO of the frame width, centred horizontally, and
placed with its centre FACE_Y of the way down. Only enlarging is possible: a source that is
already tightly cropped around a large face keeps it (at most MAX_PAD of edge pixels are
replicated, never invented background). Exit code 3 means no face was found (nothing is written).
"""

import argparse
import json
import sys

import cv2
import numpy as np

FACE_RATIO = 0.44
FACE_Y = 0.45
MAX_PAD = 0.03
SIZE = 256
MODEL = "/home/deck/.cache/puma-img/yunet.onnx"


def read_image(path):
    raw = np.fromfile(path, dtype="uint8")
    image = cv2.imdecode(raw, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise ValueError(f"無法讀取圖片：{path}")
    if image.ndim == 2:
        image = cv2.cvtColor(image, cv2.COLOR_GRAY2BGR)
    elif image.shape[2] == 4:  # 透明背景鋪白底，避免變成黑色
        alpha = image[:, :, 3:4].astype("float32") / 255
        image = (image[:, :, :3] * alpha + 255 * (1 - alpha)).astype("uint8")
    # IMREAD_UNCHANGED 不會套用 EXIF 方向，改用 IMREAD_COLOR 讀取一次判斷旋轉後的尺寸。
    oriented = cv2.imdecode(raw, cv2.IMREAD_COLOR)
    if oriented is not None and oriented.shape[:2] != image.shape[:2]:
        image = oriented
    return image


def find_face(image, model):
    height, width = image.shape[:2]
    scale = min(1.0, 1600 / max(height, width))
    small = cv2.resize(image, (round(width * scale), round(height * scale))) if scale < 1 else image
    detector = cv2.FaceDetectorYN.create(model, "", (small.shape[1], small.shape[0]), 0.7, 0.3, 5000)
    _, faces = detector.detect(small)
    if faces is None or not len(faces):
        return None
    face = max(faces, key=lambda item: item[2] * item[3] * item[14])
    x, y, w, h = (face[:4] / scale).tolist()
    return x, y, w, h


def window_for(face, shape, ratio=FACE_RATIO):
    """Return (left, top, side) of the square window in source coordinates.

    The window may overhang the image by at most MAX_PAD of its side. A face that is already
    larger than the target in a tightly cropped source stays larger: padding it out would
    mean inventing background, so the window is capped at the image size instead.
    """
    height, width = shape[:2]
    x, y, w, h = face
    cx, cy = x + w / 2, y + h / 2
    side = min(w / ratio, min(width, height) * (1 + 2 * MAX_PAD))
    left = min(max(cx - side / 2, -MAX_PAD * side), width - side + MAX_PAD * side)
    top = min(max(cy - FACE_Y * side, -MAX_PAD * side), height - side + MAX_PAD * side)
    return left, top, side


def render(image, left, top, side):
    height, width = image.shape[:2]
    left_i, top_i, side_i = round(left), round(top), max(round(side), 8)
    pads = (max(0, -top_i), max(0, top_i + side_i - height), max(0, -left_i), max(0, left_i + side_i - width))
    if any(pads):
        image = cv2.copyMakeBorder(image, *pads, cv2.BORDER_REPLICATE)
        left_i += pads[2]
        top_i += pads[0]
    crop = image[top_i:top_i + side_i, left_i:left_i + side_i]
    interpolation = cv2.INTER_AREA if side_i > SIZE else cv2.INTER_LANCZOS4
    return cv2.resize(crop, (SIZE, SIZE), interpolation=interpolation), any(pads)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source")
    parser.add_argument("output")
    parser.add_argument("--crop", help="先用 left,top,width,height 預裁，再偵測臉部")
    parser.add_argument("--model", default=MODEL)
    args = parser.parse_args()

    image = read_image(args.source)
    if args.crop:
        left, top, width, height = map(int, args.crop.split(","))
        image = image[top:top + height, left:left + width]
    face = find_face(image, args.model)
    if face is None:
        print(json.dumps({"face": None}))
        return 3
    left, top, side = window_for(face, image.shape)
    result, padded = render(image, left, top, side)
    if not cv2.imwrite(args.output, result, [cv2.IMWRITE_WEBP_QUALITY, 82]):
        raise ValueError("寫入 WebP 失敗")
    print(json.dumps({"face_ratio": round(face[2] / side, 3), "padded": padded, "source": [image.shape[1], image.shape[0]]}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
