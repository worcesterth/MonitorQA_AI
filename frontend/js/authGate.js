/** ช่วยผูก UI "เข้าสู่ระบบก่อนใช้งาน" (อีเมล+รหัสผ่าน) ที่ใช้ซ้ำกันหลายหน้า (ทดสอบ/ประวัติ/เปรียบเทียบ/
 *  ลงทะเบียนจอ/โปรไฟล์) — คาดหวัง markup ตาม id pattern: #{prefix}-login-panel, #{prefix}-login-email,
 *  #{prefix}-login-password, #{prefix}-login-btn, #{prefix}-login-back-btn, #{prefix}-login-error
 *  (ปุ่ม "สมัครสมาชิก" #{prefix}-login-signup-link ไม่บังคับ — ใส่ถ้าอยากให้มีลิงก์ไปหน้าสมัครสมาชิก)
 *
 * เรียก wireLoginGate ครั้งเดียวตอน init หน้านั้นๆ แล้วเรียก gate.enter() ทุกครั้งที่จะเข้าหน้านี้
 * (เช่นตอน tab activate) — enter() เช็คสถานะล็อกอินที่ใช้ร่วมกันเอง ถ้ายังไม่ล็อกอินจะโชว์ฟอร์มแล้วรอ
 * ถ้าล็อกอินอยู่แล้วจะซ่อนฟอร์มแล้วเรียก onEnter(user) ทันที */
import { loginWithEmail } from "./api.js";
import { getCurrentUser, setCurrentUser } from "./auth.js";

export function wireLoginGate({ prefix, onBack, onEnter, onSignup }) {
  const panel = document.getElementById(`${prefix}-login-panel`);
  const emailInput = document.getElementById(`${prefix}-login-email`);
  const passwordInput = document.getElementById(`${prefix}-login-password`);
  const loginBtn = document.getElementById(`${prefix}-login-btn`);
  const backBtn = document.getElementById(`${prefix}-login-back-btn`);
  const errorEl = document.getElementById(`${prefix}-login-error`);
  const signupLink = document.getElementById(`${prefix}-login-signup-link`);

  async function handleLogin() {
    errorEl.hidden = true;
    if (!emailInput.value.trim() || !passwordInput.value) {
      errorEl.textContent = "กรุณากรอกอีเมลและรหัสผ่าน";
      errorEl.hidden = false;
      return;
    }
    loginBtn.disabled = true;
    const originalLabel = loginBtn.innerHTML;
    loginBtn.textContent = "กำลังตรวจสอบ...";
    try {
      const user = await loginWithEmail(emailInput.value.trim(), passwordInput.value);
      setCurrentUser(user);
      passwordInput.value = "";
      await enter();
    } catch (e) {
      errorEl.textContent = e.message || "เข้าสู่ระบบไม่สำเร็จ";
      errorEl.hidden = false;
    } finally {
      loginBtn.disabled = false;
      loginBtn.innerHTML = originalLabel;
    }
  }

  async function enter() {
    const user = getCurrentUser();
    if (!user) {
      panel.hidden = false;
      await onEnter(null);
      return;
    }
    panel.hidden = true;
    await onEnter(user);
  }

  loginBtn.addEventListener("click", handleLogin);
  backBtn.addEventListener("click", () => onBack?.());
  signupLink?.addEventListener("click", () => onSignup?.());

  return { enter };
}
