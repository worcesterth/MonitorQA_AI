"""
Backend หลักของเว็บแอปประเมินคุณภาพจอแสดงผลทางการแพทย์ (AAPM TG18)
รัน dev: uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import base64
import json
from datetime import datetime, timezone
import numpy as np
import cv2
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from models.registry import PATTERN_CONFIG
from models.loader import load_model, predict
from preprocessing import features as feat
from preprocessing.screen_warp import preprocess_screen, PreprocessError
from preprocessing.orb_align import align_to_qc_template
from preprocessing.pattern_check import verify_pattern
import db
import email_service


def _cooldown_detail(remaining_seconds: int) -> str:
    remaining_min = max(1, (remaining_seconds + 59) // 60)  # ปัดขึ้น กันบอก "0 นาที"
    return f"รหัสเดิมยังไม่หมดอายุ กรุณารออีกประมาณ {remaining_min} นาทีก่อนขอรหัสใหม่"


def _issue_verification_code(email: str, code: str, purpose: str = "register") -> bool:
    """ส่งรหัสยืนยันไปที่อีเมลจริงถ้าตั้งค่า SMTP ไว้แล้ว (ดู backend/.env.example) — คืน True ถ้าส่งสำเร็จ
    ถ้ายังไม่ได้ตั้งค่า หรือส่งไม่สำเร็จ (เช่น เน็ตมีปัญหา/รหัสผ่านผิด) คืน False ให้ผู้เรียก fallback ไป
    คืนรหัสตรงๆ ใน response แทน (โหมดจำลอง ใช้ทดสอบระบบต่อได้โดยไม่ต้องรอตั้งค่าอีเมลจริง)"""
    if not email_service.is_configured():
        return False
    try:
        email_service.send_verification_email(email, code, purpose=purpose)
        return True
    except Exception as e:
        print(f"[email_service] ส่งอีเมลไปยัง {email} ไม่สำเร็จ: {e}")
        return False

app = FastAPI(title="TG18 Display QA")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # โปรดจำกัด origin จริงตอน deploy production
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_cache_frontend(request, call_next):
    """
    กัน browser/Live Preview แคชไฟล์ frontend (js/css/รูป) ตอน dev — เจอปัญหาแคชค้าง
    ของไฟล์เก่าซ้ำหลายครั้งระหว่างพัฒนา ถ้าจะ deploy production จริงควรตัดออกแล้วใช้ cache
    busting ด้วย content hash ในชื่อไฟล์แทน
    """
    response = await call_next(request)
    if not request.url.path.startswith("/api"):
        response.headers["Cache-Control"] = "no-store"
    return response


@app.on_event("startup")
def on_startup():
    db.init_db()


@app.get("/api/patterns")
def get_patterns():
    """คืนรายชื่อชุดทดสอบ + ชื่อการประเมินแต่ละเกณฑ์ ให้ frontend ใช้ทำ dropdown"""
    return {
        key: {
            "label": cfg["label"],
            "criteria": [{"code": c["criterion"], "name": c["name"]} for c in cfg["criteria"]],
        }
        for key, cfg in PATTERN_CONFIG.items()
    }


@app.post("/api/auth/register")
def register_account(
    full_name: str = Form(...),
    hospital: str = Form(default=""),
    phone: str = Form(default=""),
    email: str = Form(...),
    password: str = Form(...),
    confirm_password: str = Form(...),
):
    """สมัครสมาชิกด้วยอีเมล — สร้างบัญชีทันทีแต่ยัง login ไม่ได้จนกว่าจะยืนยันอีเมลด้วยรหัส 6 หลัก
    (ระบบยังไม่ได้ต่อ SMTP จริง — คืน verification_code มาให้ frontend โชว์จำลองการส่งอีเมลไปก่อน)"""
    if len(password) < 8:
        raise HTTPException(400, "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร")
    if password != confirm_password:
        raise HTTPException(400, "รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน")
    email = email.strip().lower()
    if "@" not in email:
        raise HTTPException(400, "รูปแบบอีเมลไม่ถูกต้อง")
    result = db.register_account({"full_name": full_name, "hospital": hospital, "phone": phone, "email": email, "password": password})
    if result == "duplicate_email":
        raise HTTPException(409, "อีเมลนี้ถูกใช้ลงทะเบียนแล้ว")
    user_record, code = result
    sent = _issue_verification_code(email, code, purpose="register")
    response = {"user": user_record.to_dict(), "email_sent": sent}
    if not sent:
        response["verification_code"] = code  # ยังไม่ได้ตั้งค่าอีเมลจริง (หรือส่งไม่สำเร็จ) — คืนรหัสตรงๆ ให้ทดสอบต่อได้
    return response


@app.post("/api/auth/verify-email")
def verify_email_endpoint(email: str = Form(...), code: str = Form(...)):
    """ยืนยันอีเมลตอนสมัครสมาชิก — สำเร็จแล้วถือว่า login ได้ทันที (คืนข้อมูลผู้ใช้กลับไปเหมือน login)"""
    result = db.verify_email(email.strip().lower(), code.strip())
    if result == "not_found":
        raise HTTPException(404, "ไม่พบบัญชีนี้")
    if result == "already_verified":
        raise HTTPException(400, "อีเมลนี้ยืนยันแล้ว")
    if result == "invalid_code":
        raise HTTPException(400, "รหัสยืนยันไม่ถูกต้อง")
    if result == "expired":
        raise HTTPException(400, "รหัสยืนยันหมดอายุ กรุณาขอรหัสใหม่")
    return result.to_dict()


@app.post("/api/auth/resend-code")
def resend_code_endpoint(email: str = Form(...)):
    email = email.strip().lower()
    result = db.resend_verification_code(email)
    if result == "not_found":
        raise HTTPException(404, "ไม่พบบัญชีนี้")
    if result == "already_verified":
        raise HTTPException(400, "อีเมลนี้ยืนยันแล้ว")
    if isinstance(result, tuple) and result[0] == "cooldown":
        raise HTTPException(429, _cooldown_detail(result[1]))
    sent = _issue_verification_code(email, result, purpose="register")
    response = {"email_sent": sent}
    if not sent:
        response["verification_code"] = result
    return response


@app.post("/api/auth/login")
def login(email: str = Form(...), password: str = Form(...)):
    result = db.verify_login_email(email.strip().lower(), password)
    if result in ("not_found", "wrong_password"):
        raise HTTPException(401, "อีเมลหรือรหัสผ่านไม่ถูกต้อง")
    if result == "unverified":
        raise HTTPException(403, "บัญชีนี้ยังไม่ได้ยืนยันอีเมล กรุณายืนยันก่อนเข้าสู่ระบบ")
    return result.to_dict()


@app.put("/api/users/{user_id}/profile")
def update_profile_endpoint(
    user_id: int,
    full_name: str = Form(...),
    hospital: str = Form(default=""),
    phone: str = Form(default=""),
):
    """แก้ไขชื่อ-นามสกุล/รพ/เบอร์จากเมนูโปรไฟล์ — ไม่ต้องกรอกรหัสผ่านซ้ำ"""
    result = db.update_profile(user_id, {"full_name": full_name, "hospital": hospital, "phone": phone})
    if result == "not_found":
        raise HTTPException(404, "ไม่พบผู้ใช้นี้")
    return result.to_dict()


@app.put("/api/users/{user_id}/password")
def change_password_endpoint(
    user_id: int,
    current_password: str = Form(...),
    new_password: str = Form(...),
):
    """เปลี่ยนรหัสผ่านจากเมนูโปรไฟล์ — ต้องกรอกรหัสผ่านเดิมถูกต้องก่อนถึงจะตั้งรหัสผ่านใหม่ได้"""
    if len(new_password) < 8:
        raise HTTPException(400, "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร")
    result = db.change_password(user_id, current_password, new_password)
    if result == "not_found":
        raise HTTPException(404, "ไม่พบผู้ใช้นี้")
    if result == "wrong_password":
        raise HTTPException(403, "รหัสผ่านปัจจุบันไม่ถูกต้อง")
    return result.to_dict()


@app.post("/api/users/{user_id}/email/request-change")
def request_email_change_endpoint(
    user_id: int,
    new_email: str = Form(...),
):
    """ขอเปลี่ยนอีเมลจากเมนูโปรไฟล์ — ไม่ต้องกรอกรหัสผ่านซ้ำ แต่ยังต้องยืนยันด้วยรหัส 6 หลักที่ส่งไปอีเมล
    ใหม่เหมือนเดิม ยังไม่เปลี่ยนอีเมลจริงจนกว่าจะยืนยันโค้ดสำเร็จ"""
    new_email = new_email.strip().lower()
    if "@" not in new_email:
        raise HTTPException(400, "รูปแบบอีเมลไม่ถูกต้อง")
    result = db.request_email_change(user_id, new_email)
    if result == "not_found":
        raise HTTPException(404, "ไม่พบผู้ใช้นี้")
    if result == "duplicate_email":
        raise HTTPException(409, "อีเมลนี้ถูกใช้งานแล้ว")
    if isinstance(result, tuple) and result[0] == "cooldown":
        raise HTTPException(429, _cooldown_detail(result[1]))
    sent = _issue_verification_code(new_email, result, purpose="change_email")
    response = {"email_sent": sent}
    if not sent:
        response["verification_code"] = result
    return response


@app.post("/api/users/{user_id}/email/confirm-change")
def confirm_email_change_endpoint(user_id: int, code: str = Form(...)):
    result = db.confirm_email_change(user_id, code.strip())
    if result == "not_found":
        raise HTTPException(404, "ไม่พบผู้ใช้นี้")
    if result == "no_pending":
        raise HTTPException(400, "ไม่มีคำขอเปลี่ยนอีเมลที่รอดำเนินการ")
    if result == "invalid_code":
        raise HTTPException(400, "รหัสยืนยันไม่ถูกต้อง")
    if result == "expired":
        raise HTTPException(400, "รหัสยืนยันหมดอายุ กรุณาขอรหัสใหม่")
    if result == "duplicate_email":
        raise HTTPException(409, "อีเมลนี้ถูกใช้งานไปแล้วระหว่างที่รอยืนยัน กรุณาลองอีเมลอื่น")
    return result.to_dict()


@app.post("/api/predict")
async def run_prediction(
    pattern: str = Form(...),  # รันทุกเกณฑ์ของชุดทดสอบนี้ในครั้งเดียว (TG18-CT มี 1, TG18-QC มี 3)
    tested_by: str = Form(default=""),  # ชื่อผู้ใช้ที่ล็อกอินอยู่
    display_label: str = Form(default=""),  # จอภาพที่ถูกทดสอบ
    phone: str = Form(default="unknown"),
    image: UploadFile = File(...),
):
    if pattern not in PATTERN_CONFIG:
        raise HTTPException(400, f"ไม่รู้จักชุดทดสอบ: {pattern}")

    raw = await image.read()
    arr = np.frombuffer(raw, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise HTTPException(400, "อ่านไฟล์รูปไม่ได้ — รองรับ JPG/PNG/HEIC (ผ่านการแปลงแล้ว)")

    # ---- ขั้นตอนร่วม: หาขอบจอ + perspective warp ----
    # ใช้ร่วมกันทุกการประเมิน (TG18-CT และ TG18-QC ทั้ง 3 แบบ) — หาขอบจอไม่เจอให้ถ่ายใหม่เลย
    try:
        warped = preprocess_screen(img)
    except PreprocessError as e:
        raise HTTPException(400, str(e))

    # ---- เช็กว่าภาพที่ถ่ายมาตรงกับชุดทดสอบที่เลือกจริงไหม (กันเลือกชุดทดสอบผิด/ถ่ายภาพผิด) ----
    # เทียบ ORB feature กับ template ของ pattern ที่เลือก — ทดสอบกับภาพจริงในระบบแล้วช่องว่างระหว่าง
    # "ตรง pattern" กับ "ไม่ตรง" ชัดเจนมาก (inlier หลักร้อยเทียบกับหลักสิบ) จึงตั้งเกณฑ์ 25 inlier ไว้กลางๆ
    pattern_ok, pattern_inliers = verify_pattern(warped, pattern)
    if not pattern_ok:
        pattern_label = PATTERN_CONFIG[pattern]["label"]
        raise HTTPException(
            400,
            f"ภาพนี้ดูไม่ตรงกับชุดทดสอบ {pattern_label} ที่เลือกไว้ "
            "กรุณาตรวจสอบว่าเลือกชุดทดสอบถูกต้อง และถ่ายภาพให้ตรงกับรูปแบบที่แสดงอยู่บนจอจริง",
        )

    # TG18-QC: ทำ ORB template alignment เพิ่มเติมหลัง perspective warp ทั่วไป ให้ตรงกับ pipeline
    # ที่โมเดล QC-DARK.pt/QC-BRIGHT.pt ถูกเทรนมา (screen_detect -> perspective_warp_2048 ->
    # ORB_template_align -> crop -> resize) — align ไม่สำเร็จจะคงภาพเดิมไว้ พร้อม warning แนบผล
    align_warning = None
    if pattern == "TG18-QC":
        warped, align_warning = align_to_qc_template(warped)

    # canvas ใช้ร่วมกันทุกเกณฑ์ของชุดทดสอบนี้ — แต่ละเกณฑ์วาดกรอบแดงบริเวณที่ตัวเองประเมินทับลงไป
    # เรื่อย ๆ ทีละเกณฑ์ ให้ผลลัพธ์สุดท้ายเห็นกรอบของทุกเกณฑ์รวมกันในภาพเดียว
    canvas = cv2.cvtColor(warped, cv2.COLOR_GRAY2BGR)

    cfg = PATTERN_CONFIG[pattern]
    criteria = cfg["criteria"]  # รันทุกเกณฑ์ของชุดทดสอบนี้เสมอ

    results = []

    for idx, crit in enumerate(criteria, start=1):
        feature_fn = getattr(feat, crit["feature_fn"])
        extracted = feature_fn(warped, canvas, idx)  # idx = หมายเลขกำกับ วาดบน canvas ตรงกับลำดับในรายการผล

        warning = None
        if isinstance(extracted, tuple):
            extracted, warning = extracted
        if align_warning:
            warning = f"{align_warning}; {warning}" if warning else align_warning

        if crit["model_type"] == "formula":
            out = extracted  # dict {value, pass, ...รายละเอียดอื่น ๆ ถ้ามี}
            formula_row = {
                "index": idx,
                "criterion": crit["criterion"],
                "name": crit["name"],
                "label": "Pass" if out["pass"] else "Fail",
                "confidence": None,
                "value": out["value"],
            }
            if warning:
                formula_row["warning"] = warning
            extra = {k: v for k, v in out.items() if k not in ("value", "pass")}
            if extra:
                formula_row["features"] = extra
            results.append(formula_row)
            continue

        try:
            model = load_model(crit["model_type"], crit["model_path"])
            label, conf = predict(crit["model_type"], model, extracted)
        except FileNotFoundError as e:
            results.append({
                "index": idx,
                "criterion": crit["criterion"],
                "name": crit["name"],
                "label": "N/A",
                "confidence": None,
                "error": str(e),
            })
            continue

        result_row = {
            "index": idx,
            "criterion": crit["criterion"],
            "name": crit["name"],
            "label": label,
            "confidence": round(conf, 3) if conf is not None else None,
        }
        if warning:
            result_row["warning"] = warning
        if isinstance(extracted, dict):
            result_row["features"] = extracted
        results.append(result_row)

    overall = "Pass" if all(r["label"] == "Pass" for r in results if r["label"] != "N/A") else "Fail"

    ok, buf = cv2.imencode(".png", canvas)
    processed_image_b64 = "data:image/png;base64," + base64.b64encode(buf).decode() if ok else None

    # หมายเหตุ: ไม่บันทึกลง DB ที่นี่ — ต้องกด "บันทึกผล" ที่หน้าผลลัพธ์ (POST /api/history) ผู้ใช้ถึงจะ
    # เลือกได้ว่าจะเก็บผลนี้ไว้ในประวัติหรือไม่
    return {
        "pattern": pattern,
        "pattern_label": cfg["label"],
        "phone": phone,
        "tested_by": tested_by or None,
        "display_label": display_label or None,
        "overall": overall,
        "results": results,
        "processed_image": processed_image_b64,  # ภาพหลัง warp — ไว้โชว์ผู้ใช้เท่านั้น
        "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


@app.post("/api/history")
def save_history(
    pattern: str = Form(...),
    pattern_label: str = Form(...),
    phone: str = Form(default="unknown"),
    tested_by: str = Form(default=""),
    display_label: str = Form(default=""),
    overall: str = Form(...),
    results: str = Form(...),  # JSON string ของ results list ที่ได้จาก /api/predict
    processed_image: str = Form(default=""),  # data URL ภาพที่วิเคราะห์แล้ว — เก็บไว้ใช้สร้าง PDF ย้อนหลัง
    raw_image: str = Form(default=""),  # data URL ภาพถ่ายจริงที่อัปโหลด — เก็บไว้ใช้สร้าง PDF ย้อนหลัง
):
    """บันทึกผลทดสอบลงประวัติ — เรียกแยกจาก /api/predict ตอนผู้ใช้กด "บันทึกผล" เท่านั้น"""
    try:
        results_list = json.loads(results)
    except (TypeError, ValueError):
        raise HTTPException(400, "รูปแบบ results ไม่ถูกต้อง")

    record = db.save_result(
        pattern=pattern,
        pattern_label=pattern_label,
        phone=phone,
        overall=overall,
        results=results_list,
        tested_by=tested_by or None,
        display_label=display_label or None,
        processed_image=processed_image or None,
        raw_image=raw_image or None,
    )
    return record.to_dict()


@app.get("/api/history")
def get_history(limit: int = 50, pattern: str | None = None):
    """คืนประวัติผลตรวจล่าสุด (ใหม่สุดก่อน)"""
    return db.list_results(limit=limit, pattern=pattern)


@app.get("/api/history/{result_id}")
def get_history_item(result_id: int):
    record = db.get_result(result_id)
    if record is None:
        raise HTTPException(404, "ไม่พบประวัตินี้")
    return record


@app.delete("/api/history/{result_id}")
def delete_history_item(result_id: int):
    if not db.delete_result(result_id):
        raise HTTPException(404, "ไม่พบประวัตินี้")
    return {"deleted": result_id}


@app.post("/api/register/display")
def register_display(
    brand_model: str = Form(...),
    asset_number: str = Form(...),
    location: str = Form(...),
    user_id: int = Form(...),
):
    """ลงทะเบียนจอภาพ — ต้องเป็นบัญชีที่ล็อกอิน (ยืนยันอีเมลแล้ว) เท่านั้น"""
    if not db.get_verified_user(user_id):
        raise HTTPException(401, "กรุณาเข้าสู่ระบบก่อนลงทะเบียนจอภาพ")
    display_record = db.register_display(
        {"brand_model": brand_model, "asset_number": asset_number, "location": location}
    )
    return display_record.to_dict()


@app.get("/api/displays")
def get_displays(limit: int = 50):
    """คืนรายชื่อจอภาพที่ลงทะเบียนไว้ล่าสุด (ใหม่สุดก่อน)"""
    return db.list_displays(limit=limit)


@app.put("/api/displays/{display_id}")
def edit_display(
    display_id: int,
    brand_model: str = Form(...),
    asset_number: str = Form(...),
    location: str = Form(...),
    user_id: int = Form(...),
):
    """แก้ไขข้อมูลจอภาพ — ต้องเป็นบัญชีที่ล็อกอิน (ยืนยันอีเมลแล้ว) เท่านั้น"""
    if not db.get_verified_user(user_id):
        raise HTTPException(401, "กรุณาเข้าสู่ระบบก่อนแก้ไขจอภาพ")
    display_record = db.update_display(
        display_id, {"brand_model": brand_model, "asset_number": asset_number, "location": location}
    )
    if display_record is None:
        raise HTTPException(404, "ไม่พบจอภาพนี้")
    return display_record.to_dict()


@app.delete("/api/displays/{display_id}")
def remove_display(display_id: int, user_id: int = Form(...)):
    """ลบจอภาพ — ต้องเป็นบัญชีที่ล็อกอิน (ยืนยันอีเมลแล้ว) เท่านั้น"""
    if not db.get_verified_user(user_id):
        raise HTTPException(401, "กรุณาเข้าสู่ระบบก่อนลบจอภาพ")
    if not db.delete_display(display_id):
        raise HTTPException(404, "ไม่พบจอภาพนี้")
    return {"deleted": display_id}


# --- serve frontend (ต้อง mount หลังสุด ให้ /api/* ทำงานก่อน) ---
app.mount("/", StaticFiles(directory="../frontend", html=True), name="frontend")
