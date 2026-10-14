import { registerDisplay, updateDisplay, deleteDisplay, fetchDisplays } from "../api.js";
import { wireLoginGate } from "../authGate.js";
import { getCurrentUser } from "../auth.js";

/** หน้า "การลงทะเบียน" — ตอนนี้เหลือแค่ลงทะเบียนจอภาพ (ลงทะเบียนผู้ใช้ย้ายไปหน้า "สมัครสมาชิก" แยกต่างหาก
 *  แล้ว) ต้องเข้าสู่ระบบก่อนถึงจะลงทะเบียน/แก้ไขจอภาพได้ */
export function initRegister({ onBack, onSignup } = {}) {
  const contentEl = document.getElementById("register-content");
  const contentBackBtn = document.getElementById("register-content-back-btn");
  const displayPanel = initDisplayPanel();

  contentBackBtn.addEventListener("click", () => onBack?.());

  const gate = wireLoginGate({
    prefix: "register",
    onBack,
    onSignup,
    onEnter: async (user) => {
      if (!user) {
        contentEl.hidden = true;
        return;
      }
      contentEl.hidden = false;
      await displayPanel.load();
    },
  });

  return {
    load: gate.enter,
  };
}

/* ---------- ลงทะเบียนจอภาพ + รายชื่อ (แก้ไข/ลบได้ ไม่ต้องรหัสผ่าน) ---------- */

function initDisplayPanel() {
  const brandModel = document.getElementById("reg-brand-model");
  const assetNumber = document.getElementById("reg-asset-number");
  const location = document.getElementById("reg-location");
  const submitBtn = document.getElementById("register-display-submit-btn");
  const successMsg = document.getElementById("register-display-success-msg");
  const errorMsg = document.getElementById("register-display-error-msg");

  const list = document.getElementById("register-display-list");
  const listEmpty = document.getElementById("register-display-list-empty");
  const listRefreshBtn = document.getElementById("register-display-list-refresh");

  let displays = [];
  let mode = {};

  function viewCardHtml(d) {
    const metaTxt = [d.location || "", d.asset_number ? `ครุภัณฑ์ ${d.asset_number}` : ""]
      .filter(Boolean)
      .join(" · ");
    return `
      <div class="history-card" data-id="${d.id}">
        <div class="history-card__top">
          <div>
            <div class="history-card__pattern">${d.brand_model}</div>
            <div class="history-card__meta">${metaTxt}</div>
          </div>
          <div class="row-actions row-actions--inline">
            <button class="link-btn" data-action="edit">แก้ไข</button>
            <button class="link-btn link-btn--danger" data-action="delete">ลบ</button>
          </div>
        </div>
      </div>`;
  }

  function editCardHtml(d) {
    return `
      <div class="history-card" data-id="${d.id}">
        <div class="edit-fields">
          <input class="field__input" data-field="location" value="${d.location || ""}" placeholder="ชื่อโรงพยาบาล">
          <input class="field__input" data-field="brand_model" value="${d.brand_model}" placeholder="ยี่ห้อ/รุ่นจอภาพ">
          <input class="field__input" data-field="asset_number" value="${d.asset_number || ""}" placeholder="หมายเลขครุภัณฑ์">
        </div>
        <div class="row-actions">
          <button class="link-btn" data-action="save-edit">บันทึก</button>
          <button class="link-btn" data-action="cancel">ยกเลิก</button>
        </div>
        <p class="error-msg" data-role="row-error" hidden></p>
      </div>`;
  }

  function deleteCardHtml(d) {
    return `
      <div class="history-card" data-id="${d.id}">
        <div class="history-card__pattern">${d.brand_model}</div>
        <p class="row-hint">ยืนยันลบจอภาพนี้ออกจากรายการ?</p>
        <div class="row-actions">
          <button class="link-btn link-btn--danger" data-action="confirm-delete">ยืนยันลบ</button>
          <button class="link-btn" data-action="cancel">ยกเลิก</button>
        </div>
        <p class="error-msg" data-role="row-error" hidden></p>
      </div>`;
  }

  function render() {
    listEmpty.hidden = displays.length > 0;
    list.innerHTML = displays
      .map((d) => {
        if (mode[d.id] === "edit") return editCardHtml(d);
        if (mode[d.id] === "delete") return deleteCardHtml(d);
        return viewCardHtml(d);
      })
      .join("");
  }

  async function load() {
    try {
      displays = await fetchDisplays(50);
      mode = {};
      render();
    } catch (e) {
      listEmpty.hidden = false;
    }
  }

  list.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const card = btn.closest(".history-card");
    const id = Number(card.dataset.id);
    const action = btn.dataset.action;

    if (action === "edit") {
      mode[id] = "edit";
      render();
    } else if (action === "delete") {
      mode[id] = "delete";
      render();
    } else if (action === "cancel") {
      delete mode[id];
      render();
    } else if (action === "save-edit") {
      const fields = card.querySelectorAll("[data-field]");
      const values = {};
      fields.forEach((f) => (values[f.dataset.field] = f.value.trim()));
      const errorEl = card.querySelector('[data-role="row-error"]');
      if (!values.location || !values.brand_model || !values.asset_number) {
        errorEl.textContent = "กรุณากรอกชื่อโรงพยาบาล ยี่ห้อ/รุ่นจอภาพ และหมายเลขครุภัณฑ์";
        errorEl.hidden = false;
        return;
      }
      const form = new FormData();
      form.append("brand_model", values.brand_model);
      form.append("asset_number", values.asset_number);
      form.append("location", values.location || "");
      form.append("user_id", getCurrentUser()?.id);
      try {
        await updateDisplay(id, form);
        delete mode[id];
        await load();
      } catch (err) {
        errorEl.textContent = err.message || "แก้ไขไม่สำเร็จ";
        errorEl.hidden = false;
      }
    } else if (action === "confirm-delete") {
      const errorEl = card.querySelector('[data-role="row-error"]');
      const deleteForm = new FormData();
      deleteForm.append("user_id", getCurrentUser()?.id);
      try {
        await deleteDisplay(id, deleteForm);
        await load();
      } catch (err) {
        errorEl.textContent = err.message || "ลบไม่สำเร็จ";
        errorEl.hidden = false;
      }
    }
  });

  function showSuccess(msg) {
    successMsg.textContent = msg;
    successMsg.hidden = false;
    errorMsg.hidden = true;
  }
  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
    successMsg.hidden = true;
  }

  submitBtn.addEventListener("click", async () => {
    successMsg.hidden = true;
    errorMsg.hidden = true;
    if (!location.value.trim() || !brandModel.value.trim() || !assetNumber.value.trim()) {
      showError("กรุณากรอกชื่อโรงพยาบาล ยี่ห้อ/รุ่นจอภาพ และหมายเลขครุภัณฑ์");
      return;
    }
    submitBtn.disabled = true;
    const originalLabel = submitBtn.innerHTML;
    submitBtn.textContent = "กำลังบันทึก...";

    const form = new FormData();
    form.append("brand_model", brandModel.value.trim());
    form.append("asset_number", assetNumber.value.trim());
    form.append("location", location.value.trim());
    form.append("user_id", getCurrentUser()?.id);

    try {
      await registerDisplay(form);
      showSuccess("ลงทะเบียนจอภาพสำเร็จ");
      brandModel.value = "";
      assetNumber.value = "";
      location.value = "";
      await load();
    } catch (e) {
      showError(e.message || "เกิดข้อผิดพลาดระหว่างลงทะเบียน");
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalLabel;
    }
  });

  listRefreshBtn.addEventListener("click", load);

  return { load };
}
