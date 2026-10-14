import { fetchPatterns, fetchDisplays, predict } from "../api.js";
import { getCurrentUser, logoutUser } from "../auth.js";
import { wireLoginGate } from "../authGate.js";

const ALLOWED_PATTERNS = ["TG18-CT", "TG18-QC"];
const REFERENCE_IMAGES = {
  "TG18-CT": "images/reference/tg18-ct.png",
  "TG18-QC": "images/reference/tg18-qc.png",
};

export function initCheck({ onAnalyzed, onBack, onSignup }) {
  // ---------- elements: แถบแสดงผู้ใช้ที่ล็อกอินอยู่ ----------
  const sessionPanel = document.getElementById("check-session-panel");
  const sessionName = document.getElementById("check-session-name");
  const logoutBtn = document.getElementById("check-logout-btn");

  // ---------- elements: เลือกจอภาพ ----------
  const displayPanel = document.getElementById("check-display-panel");
  const displaySelect = document.getElementById("check-display-select");
  const displayEmptyMsg = document.getElementById("check-display-empty-msg");

  // ---------- elements: เลือกชุดทดสอบ ----------
  const patternPanel = document.getElementById("check-pattern-panel");
  const patternSelect = document.getElementById("pattern-select");

  // ---------- elements: รูปตัวอย่างชุดทดสอบ ----------
  const referencePanel = document.getElementById("check-reference-panel");
  const referenceImg = document.getElementById("reference-img");

  // ---------- elements: ถ่ายภาพ/วิเคราะห์ ----------
  const capturePanel = document.getElementById("capture-panel");
  const cameraInput = document.getElementById("camera-input");
  const fileInput = document.getElementById("file-input");
  const captureEmpty = document.getElementById("capture-empty");
  const capturePreview = document.getElementById("capture-preview");
  const previewImg = document.getElementById("preview-img");
  const retakeBtn = document.getElementById("retake-btn");
  const analyzeBtn = document.getElementById("analyze-btn");
  const errorMsg = document.getElementById("error-msg");

  let patternsData = {};
  let displaysData = [];
  let selectedDisplayLabel = null;
  let selectedDisplay = null;
  let selectedPattern = null;
  let selectedFile = null;

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }
  function hideError() {
    errorMsg.hidden = true;
  }

  /* ---------- เลือกจอภาพ ---------- */

  async function loadDisplayOptions() {
    try {
      displaysData = await fetchDisplays(100);
    } catch (e) {
      displaysData = [];
    }
    displaySelect.innerHTML =
      `<option value="">— เลือกจอภาพ —</option>` +
      displaysData
        .map((d) => `<option value="${d.id}">${d.brand_model} (ครุภัณฑ์ ${d.asset_number})</option>`)
        .join("");
    displayEmptyMsg.hidden = displaysData.length > 0;
    displaySelect.disabled = displaysData.length === 0;
  }

  function handleDisplayChange() {
    const display = displaysData.find((d) => String(d.id) === displaySelect.value);
    selectedDisplay = display || null;
    selectedDisplayLabel = display ? `${display.brand_model} (ครุภัณฑ์ ${display.asset_number})` : null;
    selectedPattern = null;
    hideFromPatternOnward();
    if (selectedDisplayLabel) {
      renderPatternOptions();
      patternPanel.hidden = false;
    }
  }

  /* ---------- เลือกชุดทดสอบ ---------- */

  function renderPatternOptions() {
    const keys = ALLOWED_PATTERNS.filter((k) => patternsData[k]);
    patternSelect.innerHTML =
      `<option value="">— เลือกชุดทดสอบ —</option>` +
      keys.map((key) => `<option value="${key}">${patternsData[key].label}</option>`).join("");
  }

  function handlePatternChange() {
    const key = patternSelect.value;
    selectedPattern = key || null;
    if (!key) {
      referencePanel.hidden = true;
      hideFromCaptureOnward();
      return;
    }
    referenceImg.src = REFERENCE_IMAGES[key] || "";
    referencePanel.hidden = false;
    capturePanel.hidden = false;
    analyzeBtn.hidden = false;
  }

  /* ---------- ย้อนกลับ ---------- */

  function hideFromPatternOnward() {
    patternPanel.hidden = true;
    referencePanel.hidden = true;
    hideFromCaptureOnward();
  }
  function hideFromCaptureOnward() {
    capturePanel.hidden = true;
    analyzeBtn.hidden = true;
    resetCapture();
  }

  displaySelect.addEventListener("change", handleDisplayChange);
  patternSelect.addEventListener("change", handlePatternChange);

  /* ---------- ถ่ายภาพ/วิเคราะห์ ---------- */

  function handleFileSelected(file) {
    if (!file) return;
    selectedFile = file;
    previewImg.src = URL.createObjectURL(file);
    captureEmpty.hidden = true;
    capturePreview.hidden = false;
    analyzeBtn.disabled = false;
    hideError();
  }

  function resetCapture() {
    selectedFile = null;
    cameraInput.value = "";
    fileInput.value = "";
    captureEmpty.hidden = false;
    capturePreview.hidden = true;
    analyzeBtn.disabled = true;
  }

  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function runAnalysis() {
    if (!selectedFile || !selectedPattern) return;
    hideError();
    analyzeBtn.disabled = true;
    const originalLabel = analyzeBtn.innerHTML;
    analyzeBtn.textContent = "กำลังวิเคราะห์...";

    const currentUser = getCurrentUser();
    const form = new FormData();
    form.append("pattern", selectedPattern);
    form.append("tested_by", currentUser ? currentUser.full_name : "");
    form.append("display_label", selectedDisplayLabel || "");
    form.append("image", selectedFile);

    try {
      const [data, rawImage] = await Promise.all([predict(form), fileToDataUrl(selectedFile).catch(() => null)]);
      onAnalyzed({
        displayLabel: selectedDisplayLabel,
        display: selectedDisplay,
        patternLabel: patternsData[selectedPattern]?.label || selectedPattern,
        rawImage,
        data,
      });
    } catch (e) {
      showError(e.message || "เกิดข้อผิดพลาดระหว่างวิเคราะห์");
    } finally {
      analyzeBtn.disabled = false;
      analyzeBtn.innerHTML = originalLabel;
    }
  }

  cameraInput.addEventListener("change", (e) => handleFileSelected(e.target.files[0]));
  fileInput.addEventListener("change", (e) => handleFileSelected(e.target.files[0]));
  retakeBtn.addEventListener("click", resetCapture);
  analyzeBtn.addEventListener("click", runAnalysis);

  /* ---------- เข้าสู่ระบบ ---------- */

  function handleLogout() {
    logoutUser();
    selectedDisplayLabel = null;
    selectedDisplay = null;
    selectedPattern = null;
    displaysData = [];
    sessionPanel.hidden = true;
    displayPanel.hidden = true;
    hideFromPatternOnward();
    gate.enter();
  }

  const gate = wireLoginGate({
    prefix: "check",
    onBack,
    onSignup,
    onEnter: async (user) => {
      if (!user) {
        sessionPanel.hidden = true;
        displayPanel.hidden = true;
        hideFromPatternOnward();
        return;
      }
      sessionName.textContent = user.full_name;
      sessionPanel.hidden = false;
      if (!displaysData.length) await loadDisplayOptions();
      displayPanel.hidden = false;
    },
  });

  logoutBtn.addEventListener("click", handleLogout);

  /* ---------- init ---------- */

  gate.enter();
  fetchPatterns()
    .then((data) => {
      patternsData = data;
    })
    .catch(() => {
      showError("โหลดรายชื่อชุดทดสอบไม่สำเร็จ — ตรวจสอบว่า backend รันอยู่หรือไม่");
    });

  return {
    syncSession: gate.enter,
  };
}
