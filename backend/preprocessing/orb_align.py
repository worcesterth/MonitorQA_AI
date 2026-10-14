"""
ORB template alignment — เฉพาะ TG18-QC เพื่อชดเชยความคลาดเคลื่อนที่เหลือจาก perspective warp
แบบทั่วไป (screen_warp.preprocess_screen) ก่อนครอปตำแหน่งคงที่ (qc_crop.py) ให้ตรงกับที่โมเดล
QC-DARK.pt / QC-BRIGHT.pt ถูกเทรนมา (ดู preprocessing.steps ในไฟล์โมเดล — มีขั้นตอนนี้เพิ่มจาก
screen_detect + perspective_warp_2048 ธรรมดา)

อัลกอริทึมพอร์ตตรงจากสคริปต์ Colab จริงของผู้ใช้ (ORB + BFMatcher crossCheck + RANSAC homography —
ใช้ตัวช่วยร่วมกับ pattern_check.py ผ่าน orb_match.py)
Template: Logo/pic/TG18-QC.2k_12b_modified4.tif (16-bit) แปลงเป็น 8-bit เก็บไว้ที่
preprocessing/templates/tg18-qc.png (ภาพเดียวกับที่ใช้ทำ frontend/images/reference/tg18-qc.png)
"""
import os
import cv2
import numpy as np

from .orb_match import orb_match_homography

_TEMPLATE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates", "tg18-qc.png")
_MIN_INLIERS = 40

_template_cache = None


def _load_template() -> np.ndarray:
    global _template_cache
    if _template_cache is None:
        tpl = cv2.imread(_TEMPLATE_PATH, cv2.IMREAD_GRAYSCALE)
        if tpl is None:
            raise FileNotFoundError(f"ไม่พบไฟล์ template สำหรับ ORB alignment: {_TEMPLATE_PATH}")
        _template_cache = tpl
    return _template_cache


def align_to_qc_template(img: np.ndarray):
    """
    รับภาพ grayscale 2048x2048 ที่ warp ตรงขอบจอแล้ว (จาก screen_warp.preprocess_screen)
    คืน (aligned_image, warning: str | None) — align ไม่สำเร็จ (match/inlier ไม่พอ) คืนภาพเดิม
    พร้อม warning ว่าผลอาจคลาดเคลื่อนกว่าปกติ (ไม่ error — ให้ pipeline ทำงานต่อได้)
    """
    template = _load_template()
    h_mat, inliers = orb_match_homography(img, template)
    if h_mat is not None and inliers >= _MIN_INLIERS:
        aligned = cv2.warpPerspective(img, h_mat, (template.shape[1], template.shape[0]))
        return aligned, None
    return img, f"ORB template align ไม่สำเร็จ (inlier {inliers} จุด) ใช้ภาพจาก perspective warp ตรงๆ แทน"
