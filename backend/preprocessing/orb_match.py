"""
ฟังก์ชันช่วยจับคู่ ORB feature ระหว่างภาพ 2 ภาพ (ORB + BFMatcher crossCheck + RANSAC homography)
ใช้ร่วมกันทั้ง orb_align.py (align ภาพ TG18-QC ให้ตรง template ก่อนตัดตำแหน่งคงที่) และ
pattern_check.py (เช็กว่าภาพที่ส่งมาตรงกับชุดทดสอบที่เลือกไหมก่อนส่งเข้าโมเดล) — พอร์ตจากสคริปต์
Colab เดิมของผู้ใช้
"""
import cv2
import numpy as np

ORB_NFEATURES = 4000
TOP_N_MATCHES = 500
MIN_MATCHES = 20
RANSAC_REPROJ_THRESH = 5.0


def orb_match_homography(img_a: np.ndarray, img_b: np.ndarray):
    """คืน (homography แปลงพิกัด img_a -> img_b | None, จำนวน inlier) — คืน (None, 0) ถ้าจับคู่ feature
    ไม่ได้เลยหรือมี match ไม่ถึงขั้นต่ำ"""
    orb = cv2.ORB_create(nfeatures=ORB_NFEATURES)
    k1, d1 = orb.detectAndCompute(img_a, None)
    k2, d2 = orb.detectAndCompute(img_b, None)
    if d1 is None or d2 is None:
        return None, 0

    bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    m = sorted(bf.match(d1, d2), key=lambda x: x.distance)[:TOP_N_MATCHES]
    if len(m) < MIN_MATCHES:
        return None, 0

    src = np.float32([k1[x.queryIdx].pt for x in m]).reshape(-1, 1, 2)
    dst = np.float32([k2[x.trainIdx].pt for x in m]).reshape(-1, 1, 2)
    h_mat, mask = cv2.findHomography(src, dst, cv2.RANSAC, RANSAC_REPROJ_THRESH)
    inliers = int(mask.sum()) if mask is not None else 0
    return h_mat, inliers
