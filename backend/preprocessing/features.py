"""
จุดเสียบ pipeline การ preprocess + extract feature จริงของแต่ละการประเมิน

รับเข้า: image (grayscale 2048x2048 ที่ผ่าน screen_warp.preprocess_screen แล้ว — สำหรับ TG18-QC
ผ่าน orb_align.align_to_qc_template มาแล้วด้วย ดู main.py), canvas (BGR ขนาดเท่ากัน ใช้ร่วมกันทุก
เกณฑ์ของ pattern เดียวกัน — แต่ละฟังก์ชันวาดกรอบแดงบริเวณที่ตัวเองครอป/ประเมินลงบน canvas นี้แบบ
mutate in place เพื่อให้ผลลัพธ์สุดท้ายเห็นกรอบของทุกเกณฑ์รวมกันในภาพเดียว)
→ คืนค่า (features, warning)
"""
import numpy as np
import cv2

from .ct_grid import extract_ct_luminance_features as _extract_ct_luminance_features
from .qc_crop import (
    LOWCONTRAST_BLOCKS,
    RESOLUTION_BRIGHT_BLOCK,
    REGION1_FRAC,
    REGION2_FRAC,
    crop_block,
    draw_block,
    frac_to_block,
    pixel_mode,
)


def extract_luminance_features(image: np.ndarray, canvas: np.ndarray, criterion_number: int | None = None):
    """
    TG18-CT: การประเมินความส่องสว่างด้วย Luminance Patches (โมเดล Q1.1 จริง)
    วาดกรอบ 16 ช่องลงบน canvas ที่ส่งเข้ามา
    """
    features, _grid_refined, warnings = _extract_ct_luminance_features(image, canvas, criterion_number)
    return features, ("; ".join(warnings) if warnings else None)


def extract_resolution_features(image: np.ndarray, canvas: np.ndarray, criterion_number: int | None = None):
    """
    TG18-QC: ความสามารถในการแยกรายละเอียดในโทนสว่าง (สูตรตรง ไม่ใช่ ML)
    ครอปบริเวณ resolution โทนสว่าง (RESOLUTION_BRIGHT_BLOCK) แล้วแบ่งเป็น 2 บริเวณย่อย —
    จตุรัสกลาง (target รายละเอียด) กับผืนผ้าล่าง (แถบอ้างอิง) หา mode ของแต่ละบริเวณ
    คะแนน = mode(ผืนผ้าล่าง) - mode(จตุรัสกลาง) ผ่านถ้าคะแนน >= 0
    """
    y0, y1, x0, x1 = RESOLUTION_BRIGHT_BLOCK
    crop = crop_block(image, RESOLUTION_BRIGHT_BLOCK)
    h, w = crop.shape

    r1y0, r1y1, r1x0, r1x1 = frac_to_block(REGION1_FRAC, w, h)
    r2y0, r2y1, r2x0, r2x1 = frac_to_block(REGION2_FRAC, w, h)

    mode1 = pixel_mode(crop[r1y0:r1y1, r1x0:r1x1])
    mode2 = pixel_mode(crop[r2y0:r2y1, r2x0:r2x1])
    score = mode2 - mode1

    draw_block(canvas, RESOLUTION_BRIGHT_BLOCK, criterion_number)  # ป้ายเลขที่กรอบใหญ่กรอบเดียวพอ
    draw_block(canvas, (y0 + r1y0, y0 + r1y1, x0 + r1x0, x0 + r1x1))
    draw_block(canvas, (y0 + r2y0, y0 + r2y1, x0 + r2x0, x0 + r2x1))

    out = {
        "value": score,
        "pass": score >= 0,
        "mode_region1": mode1,
        "mode_region2": mode2,
    }
    return out, None


def extract_lowcontrast_dark_features(image: np.ndarray, canvas: np.ndarray, criterion_number: int | None = None):
    """
    TG18-QC: อักษรคอนทราสต์ต่ำในโทนมืด (โมเดลจริง QC-DARK.pt — ResNet18)
    ครอปบริเวณจริง (LOWCONTRAST_BLOCKS["dark"], Q4.6) ส่งภาพ crop ทั้งแท่งให้ predict() ไป
    resize/normalize เข้าโมเดลเอง (ดู models/loader.py)
    """
    block = LOWCONTRAST_BLOCKS["dark"]
    crop = crop_block(image, block)
    draw_block(canvas, block, criterion_number)
    return crop, None


def extract_lowcontrast_bright_features(image: np.ndarray, canvas: np.ndarray, criterion_number: int | None = None):
    """
    TG18-QC: อักษรคอนทราสต์ต่ำในโทนสว่าง (โมเดลจริง QC-BRIGHT.pt — ResNet18)
    ครอปบริเวณจริง (LOWCONTRAST_BLOCKS["bright"], Q4.8) ส่งภาพ crop ทั้งแท่งให้ predict() ไป
    resize/normalize เข้าโมเดลเอง (ดู models/loader.py)
    """
    block = LOWCONTRAST_BLOCKS["bright"]
    crop = crop_block(image, block)
    draw_block(canvas, block, criterion_number)
    return crop, None


def extract_uniformity_features(image: np.ndarray, canvas: np.ndarray = None, criterion_number: int | None = None) -> dict:
    """
    TODO: TG18 formula-based uniformity calculation (UNL80/UNL10)
      ไม่ใช่ ML — คำนวณ % uniformity ตามสูตร AAPM TG18 โดยตรง
    คืนค่าเป็น dict ที่มี key 'value' (float) และ 'pass' (bool)
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    max_l, min_l = float(gray.max()), float(gray.min())
    nonuniformity = (max_l - min_l) / (max_l + min_l) * 100 if (max_l + min_l) > 0 else 0.0
    return {"value": round(nonuniformity, 2), "pass": nonuniformity < 30.0}  # TODO: threshold จริงจาก TG18
