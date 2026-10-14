"""
TG18-CT: grid detection (4x4 patch grid ด้วย anchor patches) + flat-field correction + mode features
ดัดแปลงจาก Colab จริง (tg18_ct_preprocessing_edgeonly.py + สคริปต์ deploy โมเดล Q1.1)
ใช้เฉพาะกับเกณฑ์ CT-LUM (การประเมินความส่องสว่างด้วย Luminance Patches)

ลำดับ: screen_warp.preprocess_screen (warp 2048x2048) → flat-field correction →
       refined_boxes (หา grid 4x4) → extract p01_mode..p16_mode + dmode01..15
"""
import cv2
import numpy as np

from .draw_utils import draw_number_badge

IMG_SIZE = 2048
GRID_START = 0.227
GRID_PITCH = 0.150
PATCH_FRAC = 0.098
TARGET_FRAC = 0.34
SURR_IN_FRAC = 0.55
EDGE_MARGIN = 0.2

# ต้องเท่ากับตอนสร้าง training data ของโมเดล Q1.1 (ดูใน deploy_models/Q1.json)
GAUSSIAN_SIGMA = 30
DOWNSAMPLE = 8


def _patch_boxes():
    out = []
    p = PATCH_FRAC * IMG_SIZE
    for r in range(4):
        for c in range(4):
            x0 = (GRID_START + c * GRID_PITCH) * IMG_SIZE
            y0 = (GRID_START + r * GRID_PITCH) * IMG_SIZE
            m = EDGE_MARGIN * p
            pb = (x0 + m, y0 + m, x0 + p - m, y0 + p - m)
            cx, cy = x0 + p / 2, y0 + p / 2
            t = TARGET_FRAC * p / 2
            tb = (cx - t, cy - t, cx + t, cy + t)
            s = SURR_IN_FRAC * p / 2
            sb = (cx - s, cy - s, cx + s, cy + s)
            out.append((tuple(map(int, pb)), tuple(map(int, tb)), tuple(map(int, sb))))
    return out


_DEFAULT_BOXES = _patch_boxes()


def _find_dark_patch(img, grid_idx):
    """grid_idx 0-based: 0=แพตช์1, 1=แพตช์2, 4=แพตช์5 (สมอ 3 จุดของแถวบนสุด/คอลัมน์ซ้ายสุด)"""
    p = PATCH_FRAC * IMG_SIZE
    r, c = grid_idx // 4, grid_idx % 4
    ex0 = int((GRID_START + c * GRID_PITCH) * IMG_SIZE)
    ey0 = int((GRID_START + r * GRID_PITCH) * IMG_SIZE)
    ew = int(p)
    pad = int(ew * 1.3)
    sx0, sy0 = max(ex0 - pad, 0), max(ey0 - pad, 0)
    sx1 = min(ex0 + ew + pad, img.shape[1])
    sy1 = min(ey0 + ew + pad, img.shape[0])
    win = img[sy0:sy1, sx0:sx1]

    blur = cv2.GaussianBlur(win, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    th = cv2.morphologyEx(th, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    good = []
    for cnt in cnts:
        x, y, w, h = cv2.boundingRect(cnt)
        area_ok = (ew * 0.4) < w < (ew * 2.5)
        aspect_ok = 0.6 < w / max(h, 1) < 1.7
        fill = cv2.contourArea(cnt) / max(w * h, 1)
        if area_ok and aspect_ok and fill > 0.7:
            good.append((x, y, w, h))
    if not good:
        return None
    x, y, w, h = max(good, key=lambda b: b[2] * b[3])
    return (x + sx0, y + sy0, w, h)


def refined_boxes(img: np.ndarray):
    """
    หา grid 4x4 จริงด้วยสมอ 3 จุด (แพตช์ 1, 2, 5) แล้ว refine ตำแหน่ง/pitch
    คืน (boxes, grid_refined: bool) — ถ้าหาสมอไม่เจอ fallback เป็นพิกัดตายตัว (_DEFAULT_BOXES)
    """
    p = PATCH_FRAC * IMG_SIZE
    p1 = _find_dark_patch(img, 0)
    if p1 is None:
        return _DEFAULT_BOXES, False
    fx, fy, fw, fh = p1
    scale = ((fw / p) + (fh / p)) / 2

    p2 = _find_dark_patch(img, 1)
    p5 = _find_dark_patch(img, 4)
    default_pitch = GRID_PITCH * IMG_SIZE * scale
    pitch_x = (p2[0] - fx) if p2 is not None else default_pitch
    pitch_y = (p5[1] - fy) if p5 is not None else default_pitch
    if not (0.7 * default_pitch < pitch_x < 1.3 * default_pitch):
        pitch_x = default_pitch
    if not (0.7 * default_pitch < pitch_y < 1.3 * default_pitch):
        pitch_y = default_pitch

    pw = fw
    out = []
    for r in range(4):
        for c in range(4):
            x0, y0 = fx + c * pitch_x, fy + r * pitch_y
            m = EDGE_MARGIN * pw
            pb = (x0 + m, y0 + m, x0 + pw - m, y0 + pw - m)
            cx, cy = x0 + pw / 2, y0 + pw / 2
            t = TARGET_FRAC * pw / 2
            tb = (cx - t, cy - t, cx + t, cy + t)
            s = SURR_IN_FRAC * pw / 2
            sb = (cx - s, cy - s, cx + s, cy + s)
            out.append((tuple(map(int, pb)), tuple(map(int, tb)), tuple(map(int, sb))))
    return out, True


def polynomial_flat_field_correction(img: np.ndarray, sigma: float = GAUSSIAN_SIGMA, downsample: int = DOWNSAMPLE):
    """flat-field correction ด้วย polynomial surface องศา 2 — พารามิเตอร์ต้องตรงกับตอนเทรนโมเดล"""
    h, w = img.shape
    blurred = cv2.GaussianBlur(img, (0, 0), sigmaX=sigma, sigmaY=sigma)
    small = cv2.resize(blurred, (max(1, w // downsample), max(1, h // downsample)), interpolation=cv2.INTER_AREA)
    hs, ws = small.shape

    x, y = np.meshgrid(np.linspace(-1, 1, ws), np.linspace(-1, 1, hs))
    xf, yf, zf = x.ravel(), y.ravel(), small.ravel()
    a = np.column_stack([np.ones_like(xf), xf, yf, xf * yf, xf**2, yf**2])
    coef, _, _, _ = np.linalg.lstsq(a, zf, rcond=None)

    xg, yg = np.meshgrid(np.linspace(-1, 1, w), np.linspace(-1, 1, h))
    illum = (
        coef[0] + coef[1] * xg + coef[2] * yg + coef[3] * xg * yg + coef[4] * xg**2 + coef[5] * yg**2
    ).astype(np.float32)
    illum = np.maximum(illum, 1.0)
    ref = np.median(illum)
    return np.clip((img / illum) * ref, 0, 255).astype(np.uint8)


def _mode_of(arr: np.ndarray) -> int:
    return int(np.bincount(arr.ravel(), minlength=256).argmax())


def sanity_check(modes: list) -> dict:
    """ตรวจว่าเส้นโค้ง mode สมเหตุสมผล กันกรณี grid ตกผิดตำแหน่ง"""
    c = np.array(modes, dtype=float)
    return {
        "range_ok": bool((c.max() - c.min()) > 100),
        "p01_dark": bool(c[0] < 100),
        "p16_bright": bool(c[15] > 150),
    }


def draw_patch_boxes(canvas: np.ndarray, boxes, number: int | None = None) -> None:
    """วาดกรอบแพตช์ทั้ง 16 ช่องเป็นสีแดงลงบน canvas (BGR) ที่ส่งเข้ามา — mutate in place
    TG18-CT มีเกณฑ์เดียว (CT-LUM) ไม่ต้องมีป้ายหมายเลขกำกับ (number รับไว้เผื่อ signature ตรงกับ
    feature_fn อื่นๆ ที่ main.py เรียกแบบเดียวกันหมด แต่จงใจไม่ใช้วาดอะไร)"""
    for pb, _tb, _sb in boxes:
        x0, y0, x1, y1 = pb
        cv2.rectangle(canvas, (x0, y0), (x1, y1), (0, 0, 255), 3)


def extract_ct_luminance_features(warped_gray: np.ndarray, canvas: np.ndarray, criterion_number: int | None = None):
    """
    รับภาพ grayscale 2048x2048 ที่ warp แล้ว (จาก screen_warp.preprocess_screen)
    → flat-field correction → หา grid 4x4 → สกัด p01_mode..p16_mode + dmode01..15
    วาดกรอบ 16 ช่องลงบน canvas (BGR ขนาดเท่ากัน) ที่ส่งเข้ามา — mutate in place

    คืน (features: dict, grid_refined: bool, warnings: list[str])
    """
    corrected = polynomial_flat_field_correction(warped_gray.astype(np.float32))
    boxes, grid_refined = refined_boxes(corrected)

    modes = []
    for pb, _, _ in boxes:
        px0, py0, px1, py1 = pb
        patch = corrected[py0:py1, px0:px1]
        if patch.size == 0:
            raise ValueError("กรอบ patch หลุดขอบภาพ — grid ที่ตรวจพบผิดตำแหน่ง กรุณาถ่ายภาพใหม่")
        modes.append(_mode_of(patch))

    features = {f"p{i + 1:02d}_mode": modes[i] for i in range(16)}
    for i in range(15):
        features[f"dmode{i + 1:02d}"] = modes[i + 1] - modes[i]

    warnings = []
    if not grid_refined:
        warnings.append("หา grid ด้วยสมอ 3 จุดไม่สำเร็จ ใช้พิกัดตายตัวแทน")
    checks = sanity_check(modes)
    if not all(checks.values()):
        failed = [k for k, v in checks.items() if not v]
        warnings.append(f"เส้นโค้ง luminance ผิดปกติ ({', '.join(failed)})")

    draw_patch_boxes(canvas, boxes, criterion_number)
    return features, grid_refined, warnings
