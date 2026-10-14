import { formatDateOnly, formatTimeOnly, criterionRowsHtml } from "../utils.js";
import { saveHistory } from "../api.js";
import { downloadReportPdf } from "../pdfReport.js";

export function initResult({ onAgain, onHome }) {
  const metaDisplay = document.getElementById("result-meta-display");
  const metaPattern = document.getElementById("result-meta-pattern");
  const metaTester = document.getElementById("result-meta-tester");
  const metaDate = document.getElementById("result-meta-date");
  const metaTime = document.getElementById("result-meta-time");
  const processedImg = document.getElementById("result-processed-img");
  const resultOverall = document.getElementById("result-overall");
  const resultList = document.getElementById("result-list");
  const againBtn = document.getElementById("result-again-btn");
  const homeBtn = document.getElementById("result-home-btn");
  const saveBtn = document.getElementById("result-save-btn");
  const saveMsg = document.getElementById("result-save-msg");
  const pdfBtn = document.getElementById("result-pdf-btn");
  const pdfMsg = document.getElementById("result-pdf-msg");

  let currentData = null;
  let currentDisplayLabel = null;
  let currentDisplay = null;
  let currentRawImage = null;
  let savedHistoryId = null;

  function show({ displayLabel, display, patternLabel, rawImage, data }) {
    currentData = data;
    currentDisplayLabel = displayLabel;
    currentDisplay = display || null;
    currentRawImage = rawImage || null;
    savedHistoryId = null;

    metaDisplay.textContent = displayLabel || "—";
    metaPattern.textContent = patternLabel || "—";
    metaTester.textContent = data.tested_by || "—";
    metaDate.textContent = formatDateOnly(data.created_at);
    metaTime.textContent = formatTimeOnly(data.created_at);

    if (data.processed_image) {
      processedImg.src = data.processed_image;
      processedImg.hidden = false;
    } else {
      processedImg.hidden = true;
    }

    resultOverall.textContent = `ความน่าจะเป็นของจอภาพ: ${data.overall === "Pass" ? "ผ่าน" : "ไม่ผ่าน"}`;
    resultOverall.className = `result-overall ${data.overall === "Pass" ? "pass" : "fail"}`;
    resultList.innerHTML = criterionRowsHtml(data.results);

    saveBtn.disabled = false;
    saveBtn.hidden = false;
    saveMsg.hidden = true;

    pdfBtn.disabled = false;
    pdfBtn.hidden = false;
    pdfMsg.hidden = true;
  }

  async function handleSave() {
    if (!currentData) return;
    saveBtn.disabled = true;
    const originalLabel = saveBtn.innerHTML;
    saveBtn.textContent = "กำลังบันทึก...";
    saveMsg.hidden = true;

    const form = new FormData();
    form.append("pattern", currentData.pattern);
    form.append("pattern_label", currentData.pattern_label || currentData.pattern);
    form.append("phone", currentData.phone || "unknown");
    form.append("tested_by", currentData.tested_by || "");
    form.append("display_label", currentDisplayLabel || currentData.display_label || "");
    form.append("overall", currentData.overall);
    form.append("results", JSON.stringify(currentData.results));
    if (currentData.processed_image) form.append("processed_image", currentData.processed_image);
    if (currentRawImage) form.append("raw_image", currentRawImage);

    try {
      const saved = await saveHistory(form);
      savedHistoryId = saved?.id ?? null;
      saveMsg.textContent = "บันทึกผลลงประวัติเรียบร้อย";
      saveMsg.className = "success-msg";
      saveMsg.hidden = false;
      saveBtn.hidden = true;
    } catch (e) {
      saveMsg.textContent = e.message || "บันทึกผลไม่สำเร็จ";
      saveMsg.className = "error-msg";
      saveMsg.hidden = false;
      saveBtn.disabled = false;
      saveBtn.innerHTML = originalLabel;
    }
  }

  async function handleDownloadPdf() {
    if (!currentData) return;
    pdfBtn.disabled = true;
    const originalLabel = pdfBtn.innerHTML;
    pdfBtn.textContent = "กำลังสร้าง PDF...";
    pdfMsg.hidden = true;

    try {
      await downloadReportPdf({
        result: currentData,
        displayLabel: currentDisplayLabel || currentData.display_label,
        displayInfo: currentDisplay || undefined,
        historyId: savedHistoryId,
        rawImage: currentRawImage,
      });
    } catch (e) {
      pdfMsg.textContent = "สร้างไฟล์ PDF ไม่สำเร็จ";
      pdfMsg.hidden = false;
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = originalLabel;
    }
  }

  saveBtn.addEventListener("click", handleSave);
  pdfBtn.addEventListener("click", handleDownloadPdf);
  againBtn.addEventListener("click", () => onAgain());
  homeBtn.addEventListener("click", () => onHome());

  return { show };
}
