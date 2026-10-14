"""วาดป้ายหมายเลขกำกับกรอบผลลัพธ์บน canvas — ใช้ร่วมกันทั้ง qc_crop.py (TG18-QC) และ ct_grid.py
(TG18-CT) เพื่อให้เลขบนภาพตรงกับเลขหัวข้อการประเมินที่แสดงในรายการผลด้านล่าง (ผู้ใช้จะได้รู้ว่า
กรอบไหนในภาพคือหัวข้อไหน)"""
import cv2


def draw_number_badge(canvas, x: int, y: int, number: int, radius: int = 28) -> None:
    """วาดวงกลมสีแดงพื้นทึบ + ตัวเลขสีขาวตรงกลาง ที่ตำแหน่ง (x, y) — mutate canvas in place"""
    cv2.circle(canvas, (x, y), radius, (0, 0, 255), -1)
    cv2.circle(canvas, (x, y), radius, (255, 255, 255), 3)
    text = str(number)
    font = cv2.FONT_HERSHEY_SIMPLEX
    font_scale = radius / 22.0
    thickness = max(2, radius // 12)
    (tw, th), _ = cv2.getTextSize(text, font, font_scale, thickness)
    cv2.putText(canvas, text, (x - tw // 2, y + th // 2), font, font_scale, (255, 255, 255), thickness, cv2.LINE_AA)
