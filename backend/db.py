"""
ฐานข้อมูล SQLite เก็บประวัติผลตรวจ (ผ่าน SQLAlchemy)
ไฟล์ DB อยู่ที่ backend/data/qa_results.db (สร้างอัตโนมัติตอน startup)

หมายเหตุ: บน Render/HF Spaces free tier ดิสก์อาจไม่ persist ข้ามการ redeploy
ถ้าต้องการเก็บถาวรจริงให้ต่อ managed DB (Postgres) แทนภายหลัง
"""
import hashlib
import json
import os
import random
from datetime import datetime, timedelta

from sqlalchemy import create_engine, Column, Integer, String, Text, DateTime, Boolean
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker, declarative_base

VERIFICATION_CODE_TTL_MINUTES = 15


def _generate_code() -> str:
    return f"{random.randint(0, 999999):06d}"


def _hash_password(password: str, salt: bytes | None = None) -> tuple[str, str]:
    salt = salt or os.urandom(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, 100_000)
    return digest.hex(), salt.hex()


def _verify_password(password: str, salt_hex: str, hash_hex: str) -> bool:
    if not salt_hex or not hash_hex:
        return False
    digest_hex, _ = _hash_password(password, bytes.fromhex(salt_hex))
    return digest_hex == hash_hex

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BACKEND_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)
DB_PATH = os.path.join(DATA_DIR, "qa_results.db")

engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)
Base = declarative_base()


class QAResultRecord(Base):
    __tablename__ = "qa_results"

    id = Column(Integer, primary_key=True, index=True)
    pattern = Column(String, index=True)
    pattern_label = Column(String)
    phone = Column(String)
    tested_by = Column(String)  # ชื่อผู้ใช้ที่ล็อกอินตอนทดสอบ
    display_label = Column(String)  # จอภาพที่ถูกทดสอบ (ยี่ห้อ/รุ่น + ครุภัณฑ์)
    overall = Column(String)
    results_json = Column(Text)  # JSON string ของ list ผลรายเกณฑ์
    processed_image = Column(Text)  # data URL ของภาพที่วิเคราะห์แล้ว (ไว้ใช้สร้าง PDF ย้อนหลังจากหน้าประวัติ)
    raw_image = Column(Text)  # data URL ของภาพถ่ายจริงที่อัปโหลด (ไว้ใช้สร้าง PDF ย้อนหลังจากหน้าประวัติ)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self, include_images: bool = False):
        d = {
            "id": self.id,
            "pattern": self.pattern,
            "pattern_label": self.pattern_label,
            "phone": self.phone,
            "tested_by": self.tested_by,
            "display_label": self.display_label,
            "overall": self.overall,
            "results": json.loads(self.results_json),
            "created_at": self.created_at.isoformat() + "Z",
        }
        if include_images:  # ไม่รวมในรายการหน้าประวัติปกติ (list เบา) — รวมเฉพาะตอนดึงรายการเดียวไปสร้าง PDF
            d["processed_image"] = self.processed_image
            d["raw_image"] = self.raw_image
        return d


class UserRecord(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    full_name = Column(String)
    hospital = Column(String)  # โรงพยาบาล/หน่วยงานที่สังกัด
    phone = Column(String)
    email = Column(String, unique=True, index=True)  # ใช้ login แทนการเลือกชื่อจาก dropdown แบบเดิม
    email_verified = Column(Boolean, default=False)
    pending_email = Column(String)  # อีเมลใหม่ที่รอยืนยันตอนขอเปลี่ยนอีเมล (ยังไม่ overwrite email จริงจนกว่าจะยืนยัน)
    verification_code = Column(String)  # ใช้ร่วมกันทั้งตอนสมัครสมาชิกและตอนขอเปลี่ยนอีเมล (ไม่ overlap กันเพราะคนละช่วงเวลา)
    verification_code_expires = Column(DateTime)
    password_hash = Column(String)
    password_salt = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self):
        # ไม่คืน password_hash/password_salt/verification_code ออกไปเด็ดขาด
        return {
            "id": self.id,
            "full_name": self.full_name,
            "hospital": self.hospital,
            "phone": self.phone,
            "email": self.email,
            "email_verified": bool(self.email_verified),
            "pending_email": self.pending_email,
            "created_at": self.created_at.isoformat() + "Z",
        }


class DisplayRecord(Base):
    __tablename__ = "displays"

    id = Column(Integer, primary_key=True, index=True)
    brand_model = Column(String)
    asset_number = Column(String)  # หมายเลขครุภัณฑ์
    location = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

    def to_dict(self):
        return {
            "id": self.id,
            "brand_model": self.brand_model,
            "asset_number": self.asset_number,
            "location": self.location,
            "created_at": self.created_at.isoformat() + "Z",
        }


def init_db():
    Base.metadata.create_all(bind=engine)
    _migrate_add_columns()


def _migrate_add_columns():
    """create_all ไม่ ALTER ตารางที่มีอยู่แล้ว — เพิ่มคอลัมน์ใหม่เองถ้ายังไม่มี (เผื่อ DB เก่าจากก่อนหน้านี้)"""
    with engine.connect() as conn:
        existing = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(qa_results)")}
        if "processed_image" not in existing:
            conn.exec_driver_sql("ALTER TABLE qa_results ADD COLUMN processed_image TEXT")
        if "raw_image" not in existing:
            conn.exec_driver_sql("ALTER TABLE qa_results ADD COLUMN raw_image TEXT")
        conn.commit()

        user_cols = {row[1] for row in conn.exec_driver_sql("PRAGMA table_info(users)")}
        switching_to_email_login = "email" not in user_cols
        for col, ddl in [
            ("email", "ALTER TABLE users ADD COLUMN email TEXT"),
            ("hospital", "ALTER TABLE users ADD COLUMN hospital TEXT"),
            ("email_verified", "ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT 0"),
            ("pending_email", "ALTER TABLE users ADD COLUMN pending_email TEXT"),
            ("verification_code", "ALTER TABLE users ADD COLUMN verification_code TEXT"),
            ("verification_code_expires", "ALTER TABLE users ADD COLUMN verification_code_expires DATETIME"),
        ]:
            if col not in user_cols:
                conn.exec_driver_sql(ddl)
        conn.commit()

        # ย้ายระบบ login จาก "เลือกชื่อ+รหัสผ่าน" เป็น "อีเมล+รหัสผ่าน" — บัญชีเก่าไม่มีอีเมลผูกไว้ ใช้กับ
        # ระบบใหม่ไม่ได้ (ยืนยันกับผู้ใช้งานแล้วว่าให้ล้างบัญชีเก่าทั้งหมด ลงทะเบียนใหม่ผ่านอีเมล) ประวัติผลตรวจ
        # เดิมไม่ถูกลบ เพราะอ้างอิงด้วยชื่อ (tested_by) ไม่ใช่ user id — ทำครั้งเดียวตอนคอลัมน์ email ยังไม่มี
        if switching_to_email_login:
            conn.exec_driver_sql("DELETE FROM users")
            conn.commit()

        # ตารางนี้ถูกสร้างมาก่อนคอลัมน์ email จะมีอยู่ (เพิ่มด้วย ALTER TABLE ข้างบน) — SQLite ไม่ผูก UNIQUE
        # constraint ให้อัตโนมัติจาก unique=True ใน model กรณีนี้ ต้องสร้าง unique index เองอีกชั้น กัน
        # สมัครซ้ำอีเมลเดียวกันได้ 2 บัญชีถ้ามี request ชนกันพอดี (DB ระดับล่างบังคับแทน ไม่ใช่แค่เช็คใน python)
        conn.exec_driver_sql("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_unique ON users (email)")
        conn.commit()


def register_account(data: dict):
    """สมัครสมาชิกใหม่ — สร้างบัญชีทันทีแต่ต้องยืนยันอีเมลด้วยรหัส 6 หลักก่อนถึงจะ login ได้
    คืน (UserRecord, code) ถ้าสำเร็จ, 'duplicate_email' ถ้าอีเมลนี้ยืนยันแล้วมีคนใช้ไปแล้วจริงๆ หรือมีบัญชี
    อื่นขอเปลี่ยนมาเป็นอีเมลนี้ค้างอยู่ (รอยืนยัน) — กันแย่งอีเมลที่คนอื่น "กำลังจะเปลี่ยนมาใช้" แต่ยังกดยืนยัน
    ไม่เสร็จ ไปแอบสมัครตัดหน้าก่อน
    หมายเหตุ: ถ้าอีเมลนี้เคยสมัครไว้แต่ "ยังไม่ยืนยัน" (เช่น พิมพ์ผิด/ลืมยืนยัน/รหัสหมดอายุ) จะสมัครทับ
    ข้อมูลเดิมด้วยของใหม่ได้เลย ไม่ต้องล็อกอีเมลนั้นทิ้งถาวร — ถือว่ายังไม่ใช่บัญชีที่ "ถูกใช้จริง" จนกว่าจะ
    ยืนยันสำเร็จ"""
    session = SessionLocal()
    try:
        existing = session.query(UserRecord).filter(UserRecord.email == data["email"]).first()
        if existing and existing.email_verified:
            return "duplicate_email"
        pending_conflict = session.query(UserRecord).filter(UserRecord.pending_email == data["email"]).first()
        if pending_conflict:
            return "duplicate_email"
        password_hash, password_salt = _hash_password(data.get("password") or "")
        code = _generate_code()
        if existing:
            user_record = existing
            user_record.full_name = data.get("full_name")
            user_record.hospital = data.get("hospital")
            user_record.phone = data.get("phone")
            user_record.password_hash = password_hash
            user_record.password_salt = password_salt
        else:
            user_record = UserRecord(
                full_name=data.get("full_name"),
                hospital=data.get("hospital"),
                phone=data.get("phone"),
                email=data["email"],
                email_verified=False,
                password_hash=password_hash,
                password_salt=password_salt,
            )
            session.add(user_record)
        user_record.verification_code = code
        user_record.verification_code_expires = datetime.utcnow() + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
        try:
            session.commit()
        except IntegrityError:  # เผื่อสมัครพร้อมกัน 2 คำขอชนกันพอดี (unique index กันไว้อีกชั้น)
            session.rollback()
            return "duplicate_email"
        session.refresh(user_record)
        return user_record, code
    finally:
        session.close()


def verify_email(email: str, code: str):
    """ยืนยันอีเมลตอนสมัครสมาชิกใหม่ — คืน UserRecord ถ้าสำเร็จ
    'not_found' / 'already_verified' / 'invalid_code' / 'expired' ถ้าไม่สำเร็จ"""
    session = SessionLocal()
    try:
        user_record = session.query(UserRecord).filter(UserRecord.email == email).first()
        if not user_record:
            return "not_found"
        if user_record.email_verified:
            return "already_verified"
        if not user_record.verification_code or user_record.verification_code != code:
            return "invalid_code"
        if not user_record.verification_code_expires or datetime.utcnow() > user_record.verification_code_expires:
            return "expired"
        user_record.email_verified = True
        user_record.verification_code = None
        user_record.verification_code_expires = None
        session.commit()
        session.refresh(user_record)
        return user_record
    finally:
        session.close()


def resend_verification_code(email: str):
    """ออกรหัสยืนยันใหม่ (เผื่อรหัสเดิมหมดอายุ) — คืน code (str) ถ้าสำเร็จ, 'not_found' / 'already_verified' ถ้าไม่สำเร็จ
    ('cooldown', วินาทีที่เหลือ) ถ้ารหัสเดิมยังไม่หมดอายุ (กันขอรหัสถี่เกินไป — ต้องรอให้รหัสเดิมหมดอายุก่อน
    ถึงจะขอใหม่ได้ เพื่อไม่ให้มีรหัสที่ใช้ได้พร้อมกันหลายตัว)"""
    session = SessionLocal()
    try:
        user_record = session.query(UserRecord).filter(UserRecord.email == email).first()
        if not user_record:
            return "not_found"
        if user_record.email_verified:
            return "already_verified"
        if user_record.verification_code_expires and datetime.utcnow() < user_record.verification_code_expires:
            remaining = int((user_record.verification_code_expires - datetime.utcnow()).total_seconds())
            return "cooldown", remaining
        code = _generate_code()
        user_record.verification_code = code
        user_record.verification_code_expires = datetime.utcnow() + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
        session.commit()
        return code
    finally:
        session.close()


def verify_login_email(email: str, password: str):
    """คืน UserRecord ถ้า login สำเร็จ, 'not_found' / 'wrong_password' / 'unverified' ถ้าไม่สำเร็จ"""
    session = SessionLocal()
    try:
        user_record = session.query(UserRecord).filter(UserRecord.email == email).first()
        if not user_record:
            return "not_found"
        if not _verify_password(password, user_record.password_salt, user_record.password_hash):
            return "wrong_password"
        if not user_record.email_verified:
            return "unverified"
        return user_record
    finally:
        session.close()


def update_profile(user_id: int, data: dict):
    """แก้ไขชื่อ-นามสกุล/รพ/เบอร์ — ไม่ต้องกรอกรหัสผ่านซ้ำ (ไม่แตะอีเมล/รหัสผ่าน — แยกไปคนละ endpoint
    เพราะต้องมีขั้นตอนยืนยันเพิ่ม) คืน UserRecord ถ้าสำเร็จ, 'not_found' ถ้าไม่สำเร็จ"""
    session = SessionLocal()
    try:
        user_record = session.get(UserRecord, user_id)
        if not user_record:
            return "not_found"
        if data.get("full_name") is not None:
            user_record.full_name = data["full_name"]
        if data.get("hospital") is not None:
            user_record.hospital = data["hospital"]
        if data.get("phone") is not None:
            user_record.phone = data["phone"]
        session.commit()
        session.refresh(user_record)
        return user_record
    finally:
        session.close()


def change_password(user_id: int, current_password: str, new_password: str):
    """เปลี่ยนรหัสผ่าน — ต้องกรอกรหัสผ่านเดิมถูกต้องก่อนเสมอ
    คืน UserRecord ถ้าสำเร็จ, 'not_found' / 'wrong_password' ถ้าไม่สำเร็จ"""
    session = SessionLocal()
    try:
        user_record = session.get(UserRecord, user_id)
        if not user_record:
            return "not_found"
        if not _verify_password(current_password, user_record.password_salt, user_record.password_hash):
            return "wrong_password"
        password_hash, password_salt = _hash_password(new_password)
        user_record.password_hash = password_hash
        user_record.password_salt = password_salt
        session.commit()
        session.refresh(user_record)
        return user_record
    finally:
        session.close()


def request_email_change(user_id: int, new_email: str):
    """ขอเปลี่ยนอีเมล — ไม่ต้องกรอกรหัสผ่านซ้ำ (ยังคงต้องยืนยันด้วยรหัส 6 หลักที่ส่งไปอีเมลใหม่เหมือนเดิม
    ยังไม่เปลี่ยน email จริงจนกว่าจะยืนยันโค้ดสำเร็จ) คืน code (str) ถ้าสำเร็จ, 'not_found' / 'duplicate_email' ถ้าไม่สำเร็จ
    ('cooldown', วินาทีที่เหลือ) ถ้ามีคำขอเปลี่ยนอีเมลที่รหัสยังไม่หมดอายุค้างอยู่แล้ว (กันขอรัว ๆ)"""
    session = SessionLocal()
    try:
        user_record = session.get(UserRecord, user_id)
        if not user_record:
            return "not_found"
        if user_record.pending_email and user_record.verification_code_expires and datetime.utcnow() < user_record.verification_code_expires:
            remaining = int((user_record.verification_code_expires - datetime.utcnow()).total_seconds())
            return "cooldown", remaining
        existing = session.query(UserRecord).filter(UserRecord.email == new_email, UserRecord.id != user_id).first()
        if existing:
            return "duplicate_email"
        pending_conflict = (
            session.query(UserRecord).filter(UserRecord.pending_email == new_email, UserRecord.id != user_id).first()
        )
        if pending_conflict:
            return "duplicate_email"
        code = _generate_code()
        user_record.pending_email = new_email
        user_record.verification_code = code
        user_record.verification_code_expires = datetime.utcnow() + timedelta(minutes=VERIFICATION_CODE_TTL_MINUTES)
        session.commit()
        return code
    finally:
        session.close()


def confirm_email_change(user_id: int, code: str):
    """ยืนยันเปลี่ยนอีเมลด้วยรหัส 6 หลักที่ส่งไปอีเมลใหม่ — คืน UserRecord ถ้าสำเร็จ
    'not_found' / 'no_pending' / 'invalid_code' / 'expired' / 'duplicate_email' ถ้าไม่สำเร็จ"""
    session = SessionLocal()
    try:
        user_record = session.get(UserRecord, user_id)
        if not user_record:
            return "not_found"
        if not user_record.pending_email:
            return "no_pending"
        if not user_record.verification_code or user_record.verification_code != code:
            return "invalid_code"
        if not user_record.verification_code_expires or datetime.utcnow() > user_record.verification_code_expires:
            return "expired"
        user_record.email = user_record.pending_email
        user_record.pending_email = None
        user_record.verification_code = None
        user_record.verification_code_expires = None
        try:
            session.commit()
        except IntegrityError:  # เผื่อมีคนอื่นจดอีเมลนี้ไปพอดีระหว่างที่รอยืนยัน (unique index กันไว้อีกชั้น)
            session.rollback()
            return "duplicate_email"
        session.refresh(user_record)
        return user_record
    finally:
        session.close()


def get_verified_user(user_id: int) -> UserRecord | None:
    """คืน UserRecord ถ้า user_id นี้มีอยู่จริงและยืนยันอีเมลแล้ว ไม่งั้นคืน None — ใช้เป็นตัวยืนยันเบาๆ
    ว่า request นี้มาจากบัญชีที่ล็อกอินอยู่จริง (แอปนี้ไม่มี session/token ฝั่งเซิร์ฟเวอร์ ฝั่ง frontend
    จึงต้องแนบ user_id ของ currentUser มาด้วยทุกครั้งที่เรียก endpoint ที่ต้องล็อกอินก่อน)"""
    session = SessionLocal()
    try:
        user_record = session.get(UserRecord, user_id)
        if user_record and user_record.email_verified:
            return user_record
        return None
    finally:
        session.close()


def register_display(display: dict) -> DisplayRecord:
    session = SessionLocal()
    try:
        display_record = DisplayRecord(
            brand_model=display.get("brand_model"),
            asset_number=display.get("asset_number"),
            location=display.get("location"),
        )
        session.add(display_record)
        session.commit()
        session.refresh(display_record)
        return display_record
    finally:
        session.close()


def update_display(display_id: int, data: dict) -> DisplayRecord | None:
    session = SessionLocal()
    try:
        display_record = session.get(DisplayRecord, display_id)
        if not display_record:
            return None
        if data.get("brand_model") is not None:
            display_record.brand_model = data["brand_model"]
        if data.get("asset_number") is not None:
            display_record.asset_number = data["asset_number"]
        if data.get("location") is not None:
            display_record.location = data["location"]
        session.commit()
        session.refresh(display_record)
        return display_record
    finally:
        session.close()


def delete_display(display_id: int) -> bool:
    session = SessionLocal()
    try:
        display_record = session.get(DisplayRecord, display_id)
        if not display_record:
            return False
        session.delete(display_record)
        session.commit()
        return True
    finally:
        session.close()


def list_displays(limit: int = 50) -> list:
    session = SessionLocal()
    try:
        query = session.query(DisplayRecord).order_by(DisplayRecord.created_at.desc())
        return [d.to_dict() for d in query.limit(limit).all()]
    finally:
        session.close()


def save_result(
    pattern: str,
    pattern_label: str,
    phone: str,
    overall: str,
    results: list,
    tested_by: str | None = None,
    display_label: str | None = None,
    processed_image: str | None = None,
    raw_image: str | None = None,
) -> QAResultRecord:
    session = SessionLocal()
    try:
        record = QAResultRecord(
            pattern=pattern,
            pattern_label=pattern_label,
            phone=phone,
            tested_by=tested_by,
            display_label=display_label,
            overall=overall,
            results_json=json.dumps(results, ensure_ascii=False),
            processed_image=processed_image,
            raw_image=raw_image,
        )
        session.add(record)
        session.commit()
        session.refresh(record)
        return record
    finally:
        session.close()


def list_results(limit: int = 50, pattern: str | None = None) -> list:
    session = SessionLocal()
    try:
        query = session.query(QAResultRecord).order_by(QAResultRecord.created_at.desc())
        if pattern:
            query = query.filter(QAResultRecord.pattern == pattern)
        return [r.to_dict() for r in query.limit(limit).all()]
    finally:
        session.close()


def get_result(result_id: int):
    session = SessionLocal()
    try:
        record = session.get(QAResultRecord, result_id)
        return record.to_dict(include_images=True) if record else None
    finally:
        session.close()


def delete_result(result_id: int) -> bool:
    session = SessionLocal()
    try:
        record = session.get(QAResultRecord, result_id)
        if not record:
            return False
        session.delete(record)
        session.commit()
        return True
    finally:
        session.close()
