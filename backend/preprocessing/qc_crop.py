"""
TG18-QC: พิกัด crop ของแต่ละ criterion บนภาพ grayscale 2048x2048 ที่ warp แล้ว
(warp เต็มขนาดจอ เหมือนกับที่ใช้กับ TG18-CT — ดู preprocessing/screen_warp.py)

พิกัดอ้างอิงจาก Colab จริง บนภาพ reference ขนาด 2048x2048:
  - QC-DARK / QC-BRIGHT (อักษรคอนทราสต์ต่ำ QUALITY CONTROL ในโทนมืด/สว่าง)
    ใช้บล็อก 'dark' / 'bright' — ตรงกับ preprocessing.crop_dark/crop_bright ในไฟล์โมเดล
    QC-DARK.pt / QC-BRIGHT.pt จริง (deploy_models/QC-DARK.pt, QC-BRIGHT.pt)
  - QC-RES (ความสามารถแยกรายละเอียดในโทนสว่าง)
    ใช้กรอบ 'bright' จากสคริปต์ครอปรายละเอียด แล้วแบ่งเป็น 2 บริเวณย่อย (REGION1/REGION2_FRAC)
    ตามสคริปต์คำนวณ score_mode_diff จริง
"""
import cv2

from .draw_utils import draw_number_badge

# บล็อกอักษรคอนทราสต์ต่ำ QUALITY CONTROL — (y0, y1, x0, x1) พิกัดพิกเซลบนภาพ 2048x2048
LOWCONTRAST_BLOCKS = {
    "dark": (1670, 1830, 420, 790),  # Q4.6
    "gray": (1670, 1830, 835, 1205),  # Q4.7 — ยังไม่มี criterion ในระบบใช้
    "bright": (1670, 1830, 1245, 1615),  # Q4.8
}

# กรอบรายละเอียด/ความละเอียด — (y0, y1, x0, x1) บนภาพ 2048x2048
RESOLUTION_BRIGHT_BLOCK = (1436, 1641, 1230, 1435)  # ใช้กับ QC-RES (ในโทนสว่าง)
RESOLUTION_DARK_BLOCK = (1436, 1641, 611, 816)  # ไว้เผื่ออนาคต — ยังไม่มี criterion ใช้

# บริเวณย่อยภายใน crop ของ QC-RES (สัดส่วน x0,y0,x1,y1 อ้างอิงจากภาพ square_bright ขนาด 660x662 จริง
# — ใช้เป็นสัดส่วนได้เพราะ RESOLUTION_BRIGHT_BLOCK ที่เราครอปจาก 2048x2048 ก็คือบริเวณเดียวกัน)
REF_W, REF_H = 660, 662
REGION1_FRAC = (274 / REF_W, 270 / REF_H, 390 / REF_W, 372 / REF_H)  # จตุรัสกลาง (target รายละเอียด)
REGION2_FRAC = (111 / REF_W, 546 / REF_H, 550 / REF_W, 610 / REF_H)  # ผืนผ้าล่าง (แถบอ้างอิง)


def crop_block(img2048, block: tuple):
    """ครอปตาม (y0, y1, x0, x1) — ใช้กับภาพ grayscale 2048x2048 ที่ warp แล้ว"""
    y0, y1, x0, x1 = block
    return img2048[y0:y1, x0:x1]


def frac_to_block(frac: tuple, w: int, h: int) -> tuple:
    """แปลงสัดส่วน (x0,y0,x1,y1) เป็นพิกัดพิกเซล (y0,y1,x0,x1) บนภาพขนาด w x h"""
    fx0, fy0, fx1, fy1 = frac
    return (round(fy0 * h), round(fy1 * h), round(fx0 * w), round(fx1 * w))


def pixel_mode(patch) -> int:
    """ค่าพิกเซลที่พบมากที่สุดในบริเวณนั้น (mode) — ใช้แบบเดียวกับสคริปต์คำนวณ score_mode_diff จริง"""
    import numpy as np

    vals, counts = np.unique(patch, return_counts=True)
    return int(vals[np.argmax(counts)])


def draw_block(canvas, block: tuple, number: int | None = None) -> None:
    """วาดกรอบแดงรอบบริเวณที่ใช้ครอปลงบน canvas (BGR) ที่ส่งเข้ามา — mutate in place
    ถ้าระบุ number จะวาดป้ายหมายเลขกำกับที่มุมบนซ้ายของกรอบด้วย (ให้ตรงกับเลขหัวข้อในรายการผล)"""
    y0, y1, x0, x1 = block
    cv2.rectangle(canvas, (x0, y0), (x1, y1), (0, 0, 255), 3)
    if number is not None:
        draw_number_badge(canvas, x0, y0, number)
