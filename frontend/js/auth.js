/** เก็บสถานะผู้ใช้ที่เข้าสู่ระบบไว้ที่เดียว ใช้ร่วมกันทุกหน้า (ทดสอบ/ประวัติ/เปรียบเทียบ/ลงทะเบียนจอ/โปรไฟล์)
 *  เข้าสู่ระบบจากหน้าไหนก็ใช้ได้ทุกหน้า — และจำสถานะไว้ใน localStorage ด้วย ไม่งั้นกด refresh หน้าเว็บทีเดียว
 *  ต้อง login ใหม่ทุกครั้ง (ตัวแปรใน memory ล้วนๆ หายไปพร้อมกับหน้าเว็บที่โหลดใหม่) จะออกจากระบบจริงต้อง
 *  กดปุ่ม "ออกจากระบบ" เท่านั้น */
import { loginWithEmail } from "./api.js";

const STORAGE_KEY = "tg18qa_current_user";

function loadStoredUser() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null; // localStorage อ่านไม่ได้ (private mode/ปิดไว้) — ก็แค่ต้อง login ใหม่ทุกครั้ง ไม่ต้อง error
  }
}

function persistUser(user) {
  try {
    if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
    else localStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    /* เขียนไม่ได้ก็ปล่อยผ่าน ไม่กระทบการใช้งานหลัก แค่จะไม่จำสถานะข้ามการ refresh */
  }
}

let currentUser = loadStoredUser();

export function getCurrentUser() {
  return currentUser;
}

/** ตั้งค่าผู้ใช้ปัจจุบันตรงๆ โดยไม่ต้อง login ซ้ำ — ใช้ตอนยืนยันอีเมลสมัครสมาชิกสำเร็จ (ถือว่า login ให้เลย) */
export function setCurrentUser(user) {
  currentUser = user;
  persistUser(user);
}

export async function loginUser(email, password) {
  currentUser = await loginWithEmail(email, password);
  persistUser(currentUser);
  return currentUser;
}

export function logoutUser() {
  currentUser = null;
  persistUser(null);
}
