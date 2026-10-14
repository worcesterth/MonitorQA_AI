const API_BASE = ""; // เว้นว่างไว้ = ใช้ origin เดียวกับหน้าเว็บ (backend serve frontend เอง)

async function request(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `เซิร์ฟเวอร์ตอบกลับผิดพลาด (${res.status})`);
  }
  if (res.status === 204) return null;
  return res.json();
}

export async function fetchPatterns() {
  return request("/api/patterns");
}

export async function predict(formData) {
  return request("/api/predict", { method: "POST", body: formData });
}

export async function fetchHistory(limit = 50) {
  return request(`/api/history?limit=${limit}`);
}

/** ดึงรายการประวัติเดียวแบบเต็ม (รวมรูปถ่ายจริง/รูปที่วิเคราะห์ ที่ไม่รวมอยู่ใน fetchHistory ปกติ) */
export async function fetchHistoryItem(id) {
  return request(`/api/history/${id}`);
}

export async function saveHistory(formData) {
  return request("/api/history", { method: "POST", body: formData });
}

export async function registerAccount(formData) {
  return request("/api/auth/register", { method: "POST", body: formData });
}

export async function verifyEmail(formData) {
  return request("/api/auth/verify-email", { method: "POST", body: formData });
}

export async function resendVerificationCode(formData) {
  return request("/api/auth/resend-code", { method: "POST", body: formData });
}

export async function loginWithEmail(email, password) {
  const form = new FormData();
  form.append("email", email);
  form.append("password", password);
  return request("/api/auth/login", { method: "POST", body: form });
}

export async function updateProfile(userId, formData) {
  return request(`/api/users/${userId}/profile`, { method: "PUT", body: formData });
}

export async function changePassword(userId, formData) {
  return request(`/api/users/${userId}/password`, { method: "PUT", body: formData });
}

export async function requestEmailChange(userId, formData) {
  return request(`/api/users/${userId}/email/request-change`, { method: "POST", body: formData });
}

export async function confirmEmailChange(userId, formData) {
  return request(`/api/users/${userId}/email/confirm-change`, { method: "POST", body: formData });
}

export async function registerDisplay(formData) {
  return request("/api/register/display", { method: "POST", body: formData });
}

export async function fetchDisplays(limit = 50) {
  return request(`/api/displays?limit=${limit}`);
}

export async function updateDisplay(displayId, formData) {
  return request(`/api/displays/${displayId}`, { method: "PUT", body: formData });
}

export async function deleteDisplay(displayId, formData) {
  return request(`/api/displays/${displayId}`, { method: "DELETE", body: formData });
}
