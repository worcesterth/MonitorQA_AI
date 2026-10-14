"""
ส่งอีเมลรหัสยืนยัน 6 หลักจริงผ่าน Gmail SMTP (smtp.gmail.com:587, STARTTLS)

ต้องตั้งค่าตัวแปรแวดล้อมก่อนถึงจะส่งอีเมลจริงได้ (ใส่ไว้ในไฟล์ backend/.env — ดู .env.example):
  SMTP_USER      อีเมล Gmail ที่ใช้ส่ง (เช่น yourapp@gmail.com)
  SMTP_PASSWORD  Gmail App Password 16 หลัก (ไม่ใช่รหัสผ่าน Gmail ปกติ — ต้องเปิด 2FA แล้วสร้างจาก
                 Google Account > Security > App passwords)
  SMTP_FROM_NAME ชื่อผู้ส่งที่จะแสดงในอีเมล (ไม่บังคับ — ค่าเริ่มต้น "TG18 Display QA")

ถ้ายังไม่ได้ตั้งค่า (ตอน dev ก่อนมีบัญชี Gmail จริง) is_configured() จะเป็น False — endpoint ที่เรียกใช้
จะ fallback ไปคืนรหัสกลับมาในผลลัพธ์ API ตรงๆ แทน (โหมดจำลอง) ให้ทดสอบระบบต่อได้โดยไม่ต้องรอตั้งค่าอีเมลจริง
"""
import os
import smtplib
from email.message import EmailMessage

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def is_configured() -> bool:
    return bool(os.environ.get("SMTP_USER") and os.environ.get("SMTP_PASSWORD"))


def send_verification_email(to_email: str, code: str, purpose: str = "register") -> None:
    """ส่งอีเมลรหัสยืนยัน — โยน Exception ถ้าส่งไม่สำเร็จ (ให้ผู้เรียกจัดการ fallback/แจ้ง error เอง)"""
    smtp_user = os.environ["SMTP_USER"]
    smtp_password = os.environ["SMTP_PASSWORD"]
    from_name = os.environ.get("SMTP_FROM_NAME", "TG18 Display QA")

    subject = "ยืนยันการเปลี่ยนอีเมล" if purpose == "change_email" else "ยืนยันการสมัครสมาชิก"
    intro = "คุณกำลังขอเปลี่ยนอีเมลของบัญชี" if purpose == "change_email" else "ขอบคุณที่สมัครสมาชิก"

    msg = EmailMessage()
    msg["Subject"] = f"{subject} — TG18 Display QA"
    msg["From"] = f"{from_name} <{smtp_user}>"
    msg["To"] = to_email
    msg.set_content(
        f"{intro} ระบบประเมินคุณภาพจอแสดงผลทางการแพทย์ (AAPM TG18)\n\n"
        f"รหัสยืนยันของคุณคือ: {code}\n\n"
        f"รหัสนี้จะหมดอายุภายใน 15 นาที กรุณากรอกรหัสนี้ในหน้าเว็บเพื่อดำเนินการต่อ\n"
        f"หากคุณไม่ได้เป็นผู้ทำรายการนี้ กรุณาเพิกเฉยต่ออีเมลฉบับนี้"
    )

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=15) as server:
        server.starttls()
        server.login(smtp_user, smtp_password)
        server.send_message(msg)
