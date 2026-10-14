import { registerAccount, verifyEmail, resendVerificationCode } from "../api.js";
import { setCurrentUser } from "../auth.js";

/** หน้าสมัครสมาชิกด้วยอีเมล — สมัครแล้วต้องยืนยันด้วยรหัส 6 หลักก่อนถึงจะใช้งานได้จริง (ระบบยังไม่ได้ต่อ
 *  SMTP จริง จึงโชว์รหัสบนหน้าจอเป็นการจำลองการส่งอีเมลไปก่อน) ยืนยันสำเร็จ = login ให้ทันที */
export function initSignup({ onBack, onDone }) {
  const formPanel = document.getElementById("signup-form-panel");
  const verifyPanel = document.getElementById("signup-verify-panel");

  const fullName = document.getElementById("signup-full-name");
  const hospital = document.getElementById("signup-hospital");
  const phone = document.getElementById("signup-phone");
  const email = document.getElementById("signup-email");
  const password = document.getElementById("signup-password");
  const confirmPassword = document.getElementById("signup-confirm-password");
  const submitBtn = document.getElementById("signup-submit-btn");
  const errorMsg = document.getElementById("signup-error-msg");
  const backBtn = document.getElementById("signup-back-btn");

  const verifyEmailLabel = document.getElementById("signup-verify-email");
  const demoNote = document.getElementById("signup-demo-note");
  const demoCode = document.getElementById("signup-demo-code");
  const verifyCode = document.getElementById("signup-verify-code");
  const verifyBtn = document.getElementById("signup-verify-btn");
  const resendBtn = document.getElementById("signup-resend-btn");
  const verifyError = document.getElementById("signup-verify-error");

  let pendingEmail = null;

  function resetForm() {
    fullName.value = "";
    hospital.value = "";
    phone.value = "";
    email.value = "";
    password.value = "";
    confirmPassword.value = "";
    errorMsg.hidden = true;
    formPanel.hidden = false;
    verifyPanel.hidden = true;
    demoNote.hidden = true;
    verifyCode.value = "";
    verifyError.hidden = true;
  }

  async function handleSubmit() {
    errorMsg.hidden = true;
    if (!fullName.value.trim() || !email.value.trim() || !password.value) {
      errorMsg.textContent = "กรุณากรอกชื่อ-นามสกุล อีเมล และรหัสผ่านให้ครบ";
      errorMsg.hidden = false;
      return;
    }
    if (password.value.length < 8) {
      errorMsg.textContent = "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร";
      errorMsg.hidden = false;
      return;
    }
    if (password.value !== confirmPassword.value) {
      errorMsg.textContent = "รหัสผ่านและการยืนยันรหัสผ่านไม่ตรงกัน";
      errorMsg.hidden = false;
      return;
    }
    submitBtn.disabled = true;
    const originalLabel = submitBtn.innerHTML;
    submitBtn.textContent = "กำลังสมัครสมาชิก...";

    const form = new FormData();
    form.append("full_name", fullName.value.trim());
    form.append("hospital", hospital.value.trim());
    form.append("phone", phone.value.trim());
    form.append("email", email.value.trim());
    form.append("password", password.value);
    form.append("confirm_password", confirmPassword.value);

    try {
      const result = await registerAccount(form);
      pendingEmail = result.user.email;
      verifyEmailLabel.textContent = pendingEmail;
      if (result.email_sent) {
        demoNote.hidden = true;
      } else {
        demoNote.hidden = false;
        demoCode.textContent = result.verification_code;
      }
      formPanel.hidden = true;
      verifyPanel.hidden = false;
    } catch (e) {
      errorMsg.textContent = e.message || "สมัครสมาชิกไม่สำเร็จ";
      errorMsg.hidden = false;
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
    }
  }

  async function handleVerify() {
    verifyError.hidden = true;
    if (!verifyCode.value.trim()) {
      verifyError.textContent = "กรุณากรอกรหัสยืนยัน";
      verifyError.hidden = false;
      return;
    }
    verifyBtn.disabled = true;
    const originalLabel = verifyBtn.innerHTML;
    verifyBtn.textContent = "กำลังยืนยัน...";

    const form = new FormData();
    form.append("email", pendingEmail);
    form.append("code", verifyCode.value.trim());

    try {
      const user = await verifyEmail(form);
      setCurrentUser(user);
      resetForm();
      onDone?.(user);
    } catch (e) {
      verifyError.textContent = e.message || "ยืนยันไม่สำเร็จ";
      verifyError.hidden = false;
    } finally {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = originalLabel;
    }
  }

  async function handleResend() {
    verifyError.hidden = true;
    resendBtn.disabled = true;
    const form = new FormData();
    form.append("email", pendingEmail);
    try {
      const result = await resendVerificationCode(form);
      if (result.email_sent) {
        demoNote.hidden = true;
      } else {
        demoNote.hidden = false;
        demoCode.textContent = result.verification_code;
      }
    } catch (e) {
      verifyError.textContent = e.message || "ขอรหัสใหม่ไม่สำเร็จ";
      verifyError.hidden = false;
    } finally {
      resendBtn.disabled = false;
    }
  }

  submitBtn.addEventListener("click", handleSubmit);
  verifyBtn.addEventListener("click", handleVerify);
  resendBtn.addEventListener("click", handleResend);
  backBtn.addEventListener("click", () => {
    resetForm();
    onBack?.();
  });

  return { reset: resetForm };
}
