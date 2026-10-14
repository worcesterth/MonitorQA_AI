"""
Preprocessing ร่วม: quality check + screen detection + perspective warp
ดัดแปลงจาก Colab จริง (tg18_ct_preprocessing_edgeonly.py) — ใช้เป็นขั้นตอนร่วมก่อน extract
feature ของทุกการประเมิน (TG18-CT และ TG18-QC ทั้ง 3 แบบ) ไม่ใช่แค่ CT เท่านั้น

Pipeline:
  1. Quality check (focus measure = variance of Laplacian + mean intensity) —
     เบลอเกินไปหรือมืด/สว่างเกินไปให้ถ่ายใหม่
  2. Screen detection (Otsu threshold + largest contour) — หาไม่เจอให้ถ่ายใหม่
  3. Perspective correction (4-corner warp เป็น WARP_SIZE x WARP_SIZE) — warp ไม่ได้ให้ถ่ายใหม่

คืนภาพ grayscale ที่ warp ตรงขอบจอแล้ว ให้ feature_fn ของแต่ละเกณฑ์ใช้ต่อ
"""
import cv2
import numpy as np

WARP_SIZE = 2048

MIN_SCREEN_AREA_RATIO = 0.20  # พื้นที่ contour ของจอต้องอย่างน้อย 20% ของภาพ (เหมือนสคริปต์ต้นฉบับ)
EDGE_TOUCH_MARGIN_RATIO = 0.004  # contour ชิดขอบภาพ (small, work=1200) ในระยะนี้ถือว่าขอบจอถูกตัดออกนอกเฟรม

BLUR_VARIANCE_MIN = 60.0  # variance of Laplacian ต่ำกว่านี้ถือว่าภาพเบลอเกินไป
MEAN_INTENSITY_MIN = 15.0  # ค่าเฉลี่ยความสว่าง (0-255) ต่ำกว่านี้ถือว่ามืดเกินไป
MEAN_INTENSITY_MAX = 245.0  # ค่าเฉลี่ยความสว่างสูงกว่านี้ถือว่าสว่าง/overexposed เกินไป


class PreprocessError(Exception):
    """ภาพไม่ผ่านขั้นตอนใดขั้นตอนหนึ่ง — ข้อความไว้บอกผู้ใช้ให้ถ่ายภาพใหม่"""


def _quality_check(gray: np.ndarray) -> None:
    """focus measure (variance of Laplacian) + mean intensity — เบลอ/มืด/สว่างเกินไปให้ถ่ายใหม่"""
    variance = cv2.Laplacian(gray, cv2.CV_64F).var()
    if variance < BLUR_VARIANCE_MIN:
        raise PreprocessError("ภาพเบลอเกินไป กรุณาถ่ายภาพใหม่ให้ชัดเจน")

    mean_intensity = float(gray.mean())
    if mean_intensity < MEAN_INTENSITY_MIN or mean_intensity > MEAN_INTENSITY_MAX:
        raise PreprocessError("ภาพมืดหรือสว่างเกินไป กรุณาถ่ายภาพใหม่")


def _order_corners(pts: np.ndarray) -> np.ndarray:
    s = pts.sum(axis=1)
    d = np.diff(pts, axis=1).ravel()
    return np.array(
        [pts[np.argmin(s)], pts[np.argmin(d)], pts[np.argmax(s)], pts[np.argmax(d)]],
        dtype=np.float32,
    )


def _detect_screen(img: np.ndarray, work: int = 1200):
    """คืน (corners, reason) — corners เป็น None ถ้าหาไม่ได้ (reason: 'not_found' หาโครงร่างจอไม่เจอ/เล็กเกินไป,
    'cut_off' เจอโครงร่างแต่ชิดขอบภาพ แปลว่าขอบจอบางด้านน่าจะถูกตัดออกนอกเฟรมไปจริง ๆ ไม่ได้แค่ตรวจไม่เจอ)"""
    h, w = img.shape[:2]
    scale = work / max(h, w)
    small = cv2.resize(img, None, fx=scale, fy=scale)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5, 5), 0)
    _, th = cv2.threshold(blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    th = cv2.morphologyEx(th, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    cnts, _ = cv2.findContours(th, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not cnts:
        return None, "not_found"
    c = max(cnts, key=cv2.contourArea)
    if cv2.contourArea(c) / (small.shape[0] * small.shape[1]) < MIN_SCREEN_AREA_RATIO:
        return None, "not_found"

    # โครงร่างที่เจอชิดขอบภาพเกินไป (บางด้านของจอน่าจะโดนตัดออกนอกเฟรม) — ถ้าปล่อยผ่านจะได้มุมที่ผิด
    # (ไล่ตามขอบภาพแทนขอบจอจริง) ทำให้ perspective warp บิดเบี้ยวผิดรูปโดยไม่มีการแจ้งเตือนใด ๆ
    sh, sw = small.shape[:2]
    margin_x = max(3, int(sw * EDGE_TOUCH_MARGIN_RATIO))
    margin_y = max(3, int(sh * EDGE_TOUCH_MARGIN_RATIO))
    x, y, box_w, box_h = cv2.boundingRect(c)
    if x <= margin_x or y <= margin_y or (x + box_w) >= sw - margin_x or (y + box_h) >= sh - margin_y:
        return None, "cut_off"

    peri = cv2.arcLength(c, True)
    approx = cv2.approxPolyDP(c, 0.02 * peri, True)
    pts = (
        approx.reshape(4, 2).astype(np.float32)
        if len(approx) == 4
        else cv2.boxPoints(cv2.minAreaRect(c)).astype(np.float32)
    )
    return _order_corners(pts) / scale, "ok"


def _correct_perspective(img: np.ndarray, corners: np.ndarray, size: int = WARP_SIZE) -> np.ndarray:
    dst = np.array([[0, 0], [size - 1, 0], [size - 1, size - 1], [0, size - 1]], dtype=np.float32)
    m = cv2.getPerspectiveTransform(corners, dst)
    return cv2.warpPerspective(img, m, (size, size))


def preprocess_screen(image_bgr: np.ndarray) -> np.ndarray:
    """
    รับภาพถ่ายจอดิบ (BGR, จาก cv2.imdecode) → คืนภาพ grayscale WARP_SIZE x WARP_SIZE
    ที่ warp ตรงขอบจอแล้ว โยน PreprocessError (พร้อมข้อความให้ถ่ายใหม่) ถ้าขั้นตอนใดไม่ผ่าน
    """
    _quality_check(cv2.cvtColor(image_bgr, cv2.COLOR_BGR2GRAY))

    corners, reason = _detect_screen(image_bgr)
    if corners is None:
        if reason == "cut_off":
            raise PreprocessError(
                "ภาพนี้เห็นขอบจอไม่ครบทั้ง 4 ด้าน (มีบางด้านถูกตัดออกนอกเฟรม) "
                "กรุณาถอยกล้องออกหรือปรับมุมถ่ายใหม่ให้เห็นขอบจอครบทั้ง 4 ด้านในภาพเดียว"
            )
        raise PreprocessError("หาขอบจอแสดงผลในภาพไม่เจอ กรุณาถ่ายให้เห็นขอบจอทั้ง 4 ด้านชัดเจนแล้วลองใหม่")

    try:
        warped = _correct_perspective(image_bgr, corners)
    except cv2.error:
        raise PreprocessError("ปรับมุมมองภาพ (perspective warp) ไม่สำเร็จ กรุณาถ่ายภาพใหม่")

    return cv2.cvtColor(warped, cv2.COLOR_BGR2GRAY)
