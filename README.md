# TG18 Display QA — เว็บแอปประเมินคุณภาพจอแสดงผล

โครงเว็บแอปสำหรับงานวิจัย: ถ่าย/อัปโหลดภาพจอแสดงผล → เลือกแพตเทิร์น (QC/CT/UNL80/UNL10) →
รันโมเดลที่ดีที่สุดของแต่ละแพตเทิร์น → แสดงผล Pass/Fail รายเกณฑ์

## โครงสร้างโปรเจกต์

```
xray-qa-app/
  backend/
    main.py                 FastAPI app (/api/patterns, /api/predict) + serve frontend
    models/
      registry.py            <-- แก้ตรงนี้: กำหนดว่าแพตเทิร์นไหนใช้โมเดลอะไร path ไหน
      loader.py               โหลด + cache โมเดล sklearn(.pkl)/torch(.pt)
      weights/                 <-- วางไฟล์โมเดลจริงที่เทรนแล้วไว้ที่นี่
    preprocessing/
      features.py             <-- แก้ตรงนี้: ใส่ pipeline extract feature จริงจาก Colab
    requirements.txt
  frontend/
    index.html / style.css / app.js    หน้าเว็บมือถือ (ไทย) ถ่ายภาพ/อัปโหลด + แสดงผล
  Dockerfile
```

## สิ่งที่ต้องเติมก่อนใช้งานจริง (มี TODO กำกับในโค้ด)

1. **`backend/models/registry.py`** — ใส่ให้ตรงกับผลสรุปจริงของพี่ว่าแต่ละ criterion (Q1.1, Q4.6, Q4.8, Q4.10, ...)
   ใช้โมเดลอะไร (`sklearn` สำหรับ SVM/GBT ที่ dump ด้วย joblib, `torch` สำหรับ CNN/FCN/MLP)
   และชื่อไฟล์ weight คืออะไร
2. **`backend/models/weights/`** — วางไฟล์ `.pkl`/`.pt` จริงตามชื่อที่อ้างใน registry.py
3. **`backend/preprocessing/features.py`** — ก็อปโค้ด preprocessing จาก Colab notebook มาแทนของ dummy:
   - `extract_qc_features`: screen detection + ORB alignment → 16-channel patch extraction
   - `extract_ct_features`: grid detection + flat-field correction → median/mode/relcon features
   - `extract_uniformity_features`: สูตร TG18 uniformity (รอ threshold ยืนยันจากอาจารย์ที่ปรึกษา)

   ⚠️ สำคัญ: ฟีเจอร์ที่ extract ออกมาต้องมี **shape และลำดับคอลัมน์ตรงกับตอนเทรนโมเดลเป๊ะ**
   ไม่งั้น `model.predict()` จะให้ผลผิดโดยไม่ error

## รันทดสอบในเครื่อง (ก่อน deploy)

```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

เปิด `http://localhost:8000` — ถ้าจะทดสอบจากมือถือในวงแลนเดียวกัน ใช้ IP เครื่อง
เช่น `http://192.168.1.xx:8000` (มือถือกับคอมต้องต่อ WiFi เดียวกัน)

## Deploy ขึ้น Cloud (ให้เข้าจากมือถือได้จริงทุกที่)

แนะนำ 2 ทางเลือกฟรี/ถูก เหมาะกับ demo วิทยานิพนธ์:

### ตัวเลือก A: Hugging Face Spaces (ฟรี, ง่ายสุด, รองรับ Docker)
1. สร้าง Space ใหม่ → เลือก SDK เป็น **Docker**
2. อัป Dockerfile + โฟลเดอร์ `backend/` `frontend/` ทั้งหมด (รวมไฟล์ weight จริง — ถ้าไฟล์ใหญ่เกิน ใช้ Git LFS)
3. Space จะ build และรันอัตโนมัติที่ port 7860 (ตั้ง `ENV PORT=7860` ใน Dockerfile หรือปล่อย default ให้ HF map ให้)
4. ได้ URL สาธารณะทันที เปิดจากมือถือได้เลย

### ตัวเลือก B: Render.com (ฟรี tier มี sleep เมื่อไม่ใช้)
1. Push โค้ดขึ้น GitHub repo
2. New → Web Service → เลือก repo → Environment: **Docker**
3. Render จะ inject ตัวแปร `PORT` ให้เอง (Dockerfile รองรับอยู่แล้ว)
4. Deploy เสร็จได้ URL แบบ `https://xxx.onrender.com`

**หมายเหตุเรื่องขนาดไฟล์โมเดล:** ถ้าใช้ PyTorch (VGG-16/EfficientNet) ไฟล์ weight อาจใหญ่หลายร้อย MB
ทั้ง HF Spaces และ Render ฟรี tier รองรับได้ แต่ build/startup จะช้าลง — ถ้าเป็นไปได้ใช้ CPU-only torch
(`torch` ธรรมดาจาก PyPI ก็เป็น CPU build อยู่แล้วถ้าไม่ระบุ CUDA)

## Endpoint ที่มี

- `GET /api/patterns` — คืนรายชื่อแพตเทิร์น + criteria สำหรับทำ dropdown
- `POST /api/predict` — form-data: `pattern`, `phone` (optional), `image` (file) →
  คืน JSON ผล Pass/Fail รายเกณฑ์ + overall

## ยังไม่ได้ทำ (ขั้นต่อไปถ้าต้องการ)

- Authentication (ตอนนี้เปิด public ทุกคนเข้าได้ถ้ารู้ URL)
- เก็บ log ผลการทดสอบลงฐานข้อมูล (ตอนนี้ไม่ persist อะไรเลย)
- HEIC ต้องแปลงเป็น JPG/PNG ก่อน หรือเพิ่ม `pillow-heif` ใน backend ถ้าจะรับไฟล์จาก iPhone ตรง ๆ
