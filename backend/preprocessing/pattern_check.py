"""
เช็กว่าภาพที่ผู้ใช้ถ่ายมา (หลัง perspective warp แล้ว) ตรงกับชุดทดสอบ (pattern) ที่เลือกไว้จริงหรือไม่
ก่อนส่งเข้าโมเดล — กันกรณีเลือกชุดทดสอบผิด (เช่น เลือก TG18-CT แต่ถ่ายจอที่แสดง TG18-QC มา) หรือถ่ายภาพ
ที่ไม่เกี่ยวข้องเข้ามาเลย

ใช้เทคนิคเดียวกับ orb_align.py (ORB + BFMatcher crossCheck + RANSAC homography ผ่าน orb_match.py)
เทียบกับ template อ้างอิงของแต่ละชุดทดสอบ — จำนวน inlier มากพอแปลว่าภาพนี้มีลวดลายตรงกับ pattern
ที่เลือกจริง จำนวนน้อยเกินไปแปลว่าไม่ตรง
"""
import os
import cv2
import numpy as np

from .orb_match import orb_match_homography

_TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
_TEMPLATE_PATHS = {
    "TG18-CT": os.path.join(_TEMPLATE_DIR, "tg18-ct.png"),
    "TG18-QC": os.path.join(_TEMPLATE_DIR, "tg18-qc.png"),
}

_MIN_INLIERS_MATCH = 25  # เกณฑ์ "ตรง pattern" — หลวมกว่าเกณฑ์ align แม่นๆ ของ QC (40) เพราะแค่เช็กว่าใช่ลวดลายเดียวกัน ไม่ต้อง align แม่นยำ

_template_cache: dict[str, np.ndarray] = {}


def _load_template(pattern: str) -> np.ndarray:
    if pattern not in _template_cache:
        path = _TEMPLATE_PATHS[pattern]
        tpl = cv2.imread(path, cv2.IMREAD_GRAYSCALE)
        if tpl is None:
            raise FileNotFoundError(f"ไม่พบไฟล์ template สำหรับตรวจสอบ pattern: {path}")
        _template_cache[pattern] = tpl
    return _template_cache[pattern]


def verify_pattern(warp_gray: np.ndarray, pattern: str) -> tuple[bool, int]:
    """คืน (ตรงกับ pattern ที่เลือกไหม, จำนวน inlier) — pattern ที่ไม่รู้จัก (ไม่มี template) ถือว่าผ่านเสมอ"""
    if pattern not in _TEMPLATE_PATHS:
        return True, 0
    template = _load_template(pattern)
    _, inliers = orb_match_homography(warp_gray, template)
    return inliers >= _MIN_INLIERS_MATCH, inliers
