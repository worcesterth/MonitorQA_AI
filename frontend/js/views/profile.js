import { updateProfile, changePassword, requestEmailChange, confirmEmailChange } from "../api.js";
import { getCurrentUser, setCurrentUser, logoutUser } from "../auth.js";
import { wireLoginGate } from "../authGate.js";

/** หน้าโปรไฟล์ — แก้ไขชื่อ-นามสกุล/รพ/เบอร์ (ไม่ต้องกรอกรหัสผ่านซ้ำ), เปลี่ยนอีเมล (ไม่ต้องกรอกรหัสผ่านซ้ำ
 *  แต่ยังต้องยืนยันอีเมลใหม่ด้วยรหัส 6 หลักเหมือนเดิม), เปลี่ยนรหัสผ่าน (ยังต้องกรอกรหัสผ่านเดิมก่อนเสมอ) */
export function initProfile({ onBack, onSignup, onLoggedOut }) {
  const contentEl = document.getElementById("profile-content");

  // ---------- ข้อมูลพื้นฐาน ----------
  const fullName = document.getElementById("profile-full-name");
  const hospital = document.getElementById("profile-hospital");
  const phone = document.getElementById("profile-phone");
  const basicSaveBtn = document.getElementById("profile-basic-save-btn");
  const basicSuccess = document.getElementById("profile-basic-success-msg");
  const basicError = document.getElementById("profile-basic-error-msg");

  // ---------- อีเมล ----------
  const currentEmailEl = document.getElementById("profile-current-email");
  const newEmail = document.getElementById("profile-new-email");
  const emailRequestBtn = document.getElementById("profile-email-request-btn");
  const emailError = document.getElementById("profile-email-error-msg");
  const emailVerifyPanel = document.getElementById("profile-email-verify-panel");
  const emailDemoNote = document.getElementById("profile-email-demo-note");
  const emailDemoCode = document.getElementById("profile-email-demo-code");
  const emailPendingLabel = document.getElementById("profile-email-pending");
  const emailCode = document.getElementById("profile-email-code");
  const emailConfirmBtn = document.getElementById("profile-email-confirm-btn");
  const emailVerifyError = document.getElementById("profile-email-verify-error");
  const emailSuccess = document.getElementById("profile-email-success-msg");

  // ---------- รหัสผ่าน ----------
  const currentPassword = document.getElementById("profile-current-password");
  const newPassword = document.getElementById("profile-new-password");
  const confirmNewPassword = document.getElementById("profile-confirm-new-password");
  const passwordSaveBtn = document.getElementById("profile-password-save-btn");
  const passwordSuccess = document.getElementById("profile-password-success-msg");
  const passwordError = document.getElementById("profile-password-error-msg");

  const logoutBtn = document.getElementById("profile-logout-btn");
  const contentBackBtn = document.getElementById("profile-content-back-btn");

  function fillFromUser(user) {
    fullName.value = user.full_name || "";
    hospital.value = user.hospital || "";
    phone.value = user.phone || "";
    currentEmailEl.textContent = user.email || "";
    newEmail.value = "";
    emailVerifyPanel.hidden = true;
    currentPassword.value = "";
    newPassword.value = "";
    confirmNewPassword.value = "";
    [basicSuccess, basicError, emailError, emailVerifyError, emailSuccess, passwordSuccess, passwordError].forEach(
      (el) => (el.hidden = true)
    );
  }

  async function handleSaveBasic() {
    basicSuccess.hidden = true;
    basicError.hidden = true;
    const user = getCurrentUser();
    if (!fullName.value.trim()) {
      basicError.textContent = "กรุณากรอกชื่อ-นามสกุล";
      basicError.hidden = false;
      return;
    }
    basicSaveBtn.disabled = true;
    const originalLabel = basicSaveBtn.innerHTML;
    basicSaveBtn.textContent = "กำลังบันทึก...";

    const form = new FormData();
    form.append("full_name", fullName.value.trim());
    form.append("hospital", hospital.value.trim());
    form.append("phone", phone.value.trim());

    try {
      const updated = await updateProfile(user.id, form);
      setCurrentUser(updated);
      basicSuccess.textContent = "บันทึกข้อมูลสำเร็จ";
      basicSuccess.hidden = false;
    } catch (e) {
      basicError.textContent = e.message || "บันทึกไม่สำเร็จ";
      basicError.hidden = false;
    } finally {
      basicSaveBtn.disabled = false;
      basicSaveBtn.innerHTML = originalLabel;
    }
  }

  async function handleRequestEmailChange() {
    emailError.hidden = true;
    emailSuccess.hidden = true;
    const user = getCurrentUser();
    if (!newEmail.value.trim()) {
      emailError.textContent = "กรุณากรอกอีเมลใหม่";
      emailError.hidden = false;
      return;
    }
    emailRequestBtn.disabled = true;
    const originalLabel = emailRequestBtn.innerHTML;
    emailRequestBtn.textContent = "กำลังส่งคำขอ...";

    const form = new FormData();
    form.append("new_email", newEmail.value.trim());

    try {
      const result = await requestEmailChange(user.id, form);
      emailPendingLabel.textContent = newEmail.value.trim();
      if (result.email_sent) {
        emailDemoNote.hidden = true;
      } else {
        emailDemoNote.hidden = false;
        emailDemoCode.textContent = result.verification_code;
      }
      emailVerifyPanel.hidden = false;
    } catch (e) {
      emailError.textContent = e.message || "ส่งคำขอไม่สำเร็จ";
      emailError.hidden = false;
    } finally {
      emailRequestBtn.disabled = false;
      emailRequestBtn.innerHTML = originalLabel;
    }
  }

  async function handleConfirmEmailChange() {
    emailVerifyError.hidden = true;
    const user = getCurrentUser();
    if (!emailCode.value.trim()) {
      emailVerifyError.textContent = "กรุณากรอกรหัสยืนยัน";
      emailVerifyError.hidden = false;
      return;
    }
    emailConfirmBtn.disabled = true;
    const originalLabel = emailConfirmBtn.innerHTML;
    emailConfirmBtn.textContent = "กำลังยืนยัน...";

    const form = new FormData();
    form.append("code", emailCode.value.trim());

    try {
      const updated = await confirmEmailChange(user.id, form);
      setCurrentUser(updated);
      currentEmailEl.textContent = updated.email;
      newEmail.value = "";
      emailCode.value = "";
      emailVerifyPanel.hidden = true;
      emailSuccess.textContent = "เปลี่ยนอีเมลสำเร็จ";
      emailSuccess.hidden = false;
    } catch (e) {
      emailVerifyError.textContent = e.message || "ยืนยันไม่สำเร็จ";
      emailVerifyError.hidden = false;
    } finally {
      emailConfirmBtn.disabled = false;
      emailConfirmBtn.innerHTML = originalLabel;
    }
  }

  async function handleChangePassword() {
    passwordSuccess.hidden = true;
    passwordError.hidden = true;
    const user = getCurrentUser();
    if (!currentPassword.value || !newPassword.value) {
      passwordError.textContent = "กรุณากรอกรหัสผ่านเดิมและรหัสผ่านใหม่ให้ครบ";
      passwordError.hidden = false;
      return;
    }
    if (newPassword.value.length < 8) {
      passwordError.textContent = "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร";
      passwordError.hidden = false;
      return;
    }
    if (newPassword.value !== confirmNewPassword.value) {
      passwordError.textContent = "รหัสผ่านใหม่และการยืนยันไม่ตรงกัน";
      passwordError.hidden = false;
      return;
    }
    passwordSaveBtn.disabled = true;
    const originalLabel = passwordSaveBtn.innerHTML;
    passwordSaveBtn.textContent = "กำลังเปลี่ยนรหัสผ่าน...";

    const form = new FormData();
    form.append("current_password", currentPassword.value);
    form.append("new_password", newPassword.value);

    try {
      const updated = await changePassword(user.id, form);
      setCurrentUser(updated);
      currentPassword.value = "";
      newPassword.value = "";
      confirmNewPassword.value = "";
      passwordSuccess.textContent = "เปลี่ยนรหัสผ่านสำเร็จ";
      passwordSuccess.hidden = false;
    } catch (e) {
      passwordError.textContent = e.message || "เปลี่ยนรหัสผ่านไม่สำเร็จ";
      passwordError.hidden = false;
    } finally {
      passwordSaveBtn.disabled = false;
      passwordSaveBtn.innerHTML = originalLabel;
    }
  }

  function handleLogout() {
    logoutUser();
    contentEl.hidden = true;
    gate.enter();
    onLoggedOut?.();
  }

  contentBackBtn.addEventListener("click", () => onBack?.());
  basicSaveBtn.addEventListener("click", handleSaveBasic);
  emailRequestBtn.addEventListener("click", handleRequestEmailChange);
  emailConfirmBtn.addEventListener("click", handleConfirmEmailChange);
  passwordSaveBtn.addEventListener("click", handleChangePassword);
  logoutBtn.addEventListener("click", handleLogout);

  const gate = wireLoginGate({
    prefix: "profile",
    onBack,
    onSignup,
    onEnter: async (user) => {
      if (!user) {
        contentEl.hidden = true;
        return;
      }
      contentEl.hidden = false;
      fillFromUser(user);
    },
  });

  return { load: gate.enter };
}
