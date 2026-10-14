import { fetchPatterns, fetchDisplays, fetchHistory, fetchHistoryItem } from "../api.js";
import { formatDate } from "../utils.js";
import { compareOutcome } from "../compareLogic.js";
import { downloadComparisonReportPdf } from "../pdfReport.js";
import { getCurrentUser } from "../auth.js";
import { wireLoginGate } from "../authGate.js";

const ALLOWED_PATTERNS = ["TG18-CT", "TG18-QC"];
const RESULT_LABEL_TH = { Pass: "ผ่าน", Fail: "ไม่ผ่าน" };
const VERDICT_CLASS = { same: "same", degraded: "degraded", drift: "drift" };

export function initCompare({ onBack, onSignup }) {
  const contentEl = document.getElementById("compare-content");

  const displaySelect = document.getElementById("compare-display-select");
  const patternSelect = document.getElementById("compare-pattern-select");
  const currentSelect = document.getElementById("compare-current-select");
  const baselineSelect = document.getElementById("compare-baseline-select");
  const errorMsg = document.getElementById("compare-error-msg");
  const runBtn = document.getElementById("compare-run-btn");
  const backBtn = document.getElementById("compare-back-btn");
  const resultsPanel = document.getElementById("compare-results-panel");
  const overallEl = document.getElementById("compare-overall");
  const listEl = document.getElementById("compare-list");
  const pdfBtn = document.getElementById("compare-pdf-btn");
  const pdfMsg = document.getElementById("compare-pdf-msg");

  let displaysData = [];
  let patternsData = {};
  let historyItems = [];
  let groupItems = []; // รายการของ (จอภาพ, ชุดทดสอบ) ที่เลือก พร้อมครั้งที่ เรียงตามเวลา
  let lastRun = null; // ผลเปรียบเทียบล่าสุด — ไว้ใช้ตอนกด "ดาวน์โหลด PDF"

  function showError(msg) {
    errorMsg.textContent = msg;
    errorMsg.hidden = false;
  }
  function hideError() {
    errorMsg.hidden = true;
  }

  /* ---------- เข้าสู่ระบบก่อนเปรียบเทียบผล — เปรียบเทียบได้เฉพาะรายการของบัญชีตัวเองเท่านั้น ---------- */

  const gate = wireLoginGate({
    prefix: "compare",
    onBack,
    onSignup,
    onEnter: async (user) => {
      if (!user) {
        contentEl.hidden = true;
        return;
      }
      contentEl.hidden = false;
      await loadOptions();
    },
  });

  async function load() {
    await gate.enter();
  }

  async function loadOptions() {
    try {
      const [displays, patterns] = await Promise.all([fetchDisplays(100), fetchPatterns()]);
      displaysData = displays;
      patternsData = patterns;
      displaySelect.innerHTML =
        `<option value="">— เลือกจอภาพ —</option>` +
        displaysData.map((d) => `<option value="${d.id}">${d.brand_model} (ครุภัณฑ์ ${d.asset_number})</option>`).join("");
    } catch (e) {
      showError("โหลดข้อมูลจอภาพ/ชุดทดสอบไม่สำเร็จ");
    }
  }

  function resetFrom(select) {
    if (select === "pattern") {
      patternSelect.innerHTML = `<option value="">— เลือกชุดทดสอบ —</option>`;
      patternSelect.disabled = true;
    }
    if (select === "pattern" || select === "current") {
      currentSelect.innerHTML = `<option value="">— เลือกครั้งที่ —</option>`;
      currentSelect.disabled = true;
    }
    baselineSelect.innerHTML = `<option value="">— เลือก Baseline —</option>`;
    baselineSelect.disabled = true;
    runBtn.disabled = true;
    resultsPanel.hidden = true;
    pdfBtn.hidden = true;
    lastRun = null;
    hideError();
  }

  function handleDisplayChange() {
    resetFrom("pattern");
    if (!displaySelect.value) return;
    const keys = ALLOWED_PATTERNS.filter((k) => patternsData[k]);
    patternSelect.innerHTML =
      `<option value="">— เลือกชุดทดสอบ —</option>` +
      keys.map((key) => `<option value="${key}">${patternsData[key].label}</option>`).join("");
    patternSelect.disabled = false;
  }

  /** หาจอภาพที่เลือกไว้ แล้วสร้าง display_label แบบ format เดียวกับที่บันทึกไว้ในประวัติ */
  function selectedDisplayLabel() {
    const display = displaysData.find((d) => String(d.id) === displaySelect.value);
    return display ? `${display.brand_model} (ครุภัณฑ์ ${display.asset_number})` : null;
  }

  async function handlePatternChange() {
    resetFrom("current");
    if (!patternSelect.value) return;

    const label = selectedDisplayLabel();
    if (!label) return;

    try {
      historyItems = await fetchHistory(1000);
    } catch (e) {
      showError("โหลดประวัติไม่สำเร็จ");
      return;
    }

    const currentUser = getCurrentUser();
    groupItems = historyItems
      .filter((it) => it.display_label === label && it.pattern === patternSelect.value && it.tested_by === currentUser?.full_name)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
      .map((it, idx) => ({ ...it, attemptNumber: idx + 1 }));

    if (groupItems.length < 2) {
      showError("จอภาพ/ชุดทดสอบนี้มีประวัติไม่พอสำหรับเปรียบเทียบ (ต้องมีอย่างน้อย 2 ครั้ง)");
      return;
    }

    currentSelect.innerHTML =
      `<option value="">— เลือกครั้งที่ —</option>` +
      groupItems
        .map((it) => `<option value="${it.attemptNumber}">ครั้งที่ ${it.attemptNumber} (${formatDate(it.created_at)})</option>`)
        .join("");
    currentSelect.disabled = false;
  }

  function handleCurrentChange() {
    baselineSelect.innerHTML = `<option value="">— เลือก Baseline —</option>`;
    baselineSelect.disabled = true;
    runBtn.disabled = true;
    resultsPanel.hidden = true;
    pdfBtn.hidden = true;
    lastRun = null;
    hideError();

    const currentAttempt = Number(currentSelect.value);
    if (!currentAttempt) return;

    const eligible = groupItems.filter((it) => it.attemptNumber < currentAttempt);
    if (!eligible.length) {
      showError("ครั้งที่เลือกไว้เป็นครั้งแรกสุด ไม่มีครั้งก่อนหน้าให้เลือกเป็น baseline");
      return;
    }

    baselineSelect.innerHTML =
      `<option value="">— เลือก Baseline —</option>` +
      eligible.map((it) => `<option value="${it.attemptNumber}">ครั้งที่ ${it.attemptNumber} (${formatDate(it.created_at)})</option>`).join("");
    baselineSelect.disabled = false;
  }

  function handleBaselineChange() {
    runBtn.disabled = !baselineSelect.value;
    resultsPanel.hidden = true;
    pdfBtn.hidden = true;
    lastRun = null;
    hideError();
  }

  /** เทียบผล 1 เกณฑ์ — คืน {name, outcome, bLabel, cLabel} หรือ null ถ้าเกณฑ์นี้เทียบไม่ได้ (N/A) */
  function compareCriterion(name, criterionCode, baselineItem, currentItem) {
    const b = baselineItem.results.find((r) => r.criterion === criterionCode);
    const c = currentItem.results.find((r) => r.criterion === criterionCode);
    if (!b || !c || b.label === "N/A" || c.label === "N/A") return null;

    const drift = baselineItem.tested_by === currentItem.tested_by ? "A" : "B";
    const outcome = compareOutcome(b.label === "Pass", c.label === "Pass", drift);
    return { name, outcome, bLabel: b.label, cLabel: c.label };
  }

  function resultLabelHtml(label) {
    const cls = label === "Pass" ? "compare-row__result--pass" : label === "Fail" ? "compare-row__result--fail" : "";
    return `<strong class="${cls}">${RESULT_LABEL_TH[label] || label}</strong>`;
  }

  function criterionRowHtml({ name, outcome, bLabel, cLabel }, baselineItem, currentItem) {
    return `
      <div class="compare-row compare-row--${outcome.code}">
        <span class="compare-row__name">${name}</span>
        <div class="compare-row__values">
          <span><u>ครั้งนี้</u> (ครั้งที่ ${currentItem.attemptNumber}): ${resultLabelHtml(cLabel)}</span>
          <span><u>Baseline</u> (ครั้งที่ ${baselineItem.attemptNumber}): ${resultLabelHtml(bLabel)}</span>
        </div>
        <span class="compare-row__verdict">${outcome.verdict}</span>
        <p class="compare-row__desc">ผลการเปรียบเทียบ: ${outcome.desc}</p>
      </div>`;
  }

  /** สรุปภาพรวมจากผลเปรียบเทียบรายเกณฑ์ทั้งหมด (ไม่ใช้ฟิลด์ overall ที่บันทึกไว้ตรง ๆ เพราะเกณฑ์
   *  ที่เป็น N/A ทำให้ overall เดิมคลาดเคลื่อนได้) — ถ้ามีเกณฑ์ไหน "คุณภาพลดลง" ให้ถือเป็นภาพรวมทันที
   *  ถ้าไม่มีแต่มี "คลาดเคลื่อน" ให้ภาพรวมเป็นคลาดเคลื่อน ไม่งั้นถือว่าเท่าเดิม */
  function summarize(comparisons) {
    const codes = comparisons.map((c) => c.outcome.code);
    if (codes.includes("degraded")) return comparisons.find((c) => c.outcome.code === "degraded").outcome;
    if (codes.includes("drift")) return comparisons.find((c) => c.outcome.code === "drift").outcome;
    return comparisons[0].outcome; // เหลือแต่ "same" ทั้งหมด
  }

  function handleRun() {
    const currentAttempt = Number(currentSelect.value);
    const baselineAttempt = Number(baselineSelect.value);
    const currentItem = groupItems.find((it) => it.attemptNumber === currentAttempt);
    const baselineItem = groupItems.find((it) => it.attemptNumber === baselineAttempt);
    if (!currentItem || !baselineItem) return;

    hideError();
    pdfBtn.hidden = true;
    pdfMsg.hidden = true;
    lastRun = null;

    const cfg = patternsData[patternSelect.value];
    const criteriaList = cfg?.criteria || currentItem.results.map((r) => ({ code: r.criterion, name: r.name }));
    const comparisons = criteriaList
      .map((c) => compareCriterion(c.name, c.code, baselineItem, currentItem))
      .filter(Boolean);

    if (!comparisons.length) {
      overallEl.textContent = "";
      overallEl.className = "result-overall";
      listEl.innerHTML = `<p class="compare-row__desc">ไม่มีเกณฑ์ที่เปรียบเทียบได้ (อาจเป็นเพราะบางเกณฑ์เป็น N/A)</p>`;
      resultsPanel.hidden = false;
      return;
    }

    const overallOutcome = summarize(comparisons);
    overallEl.textContent = `ผลการเปรียบเทียบ (${comparisons.length} เกณฑ์): ${overallOutcome.verdict}`;
    overallEl.className = `result-overall compare-overall--${overallOutcome.code}`;

    listEl.innerHTML = comparisons.map((c) => criterionRowHtml(c, baselineItem, currentItem)).join("");
    resultsPanel.hidden = false;

    lastRun = { currentItem, baselineItem, comparisons, overallOutcome };
    pdfBtn.hidden = false;
  }

  async function handleDownloadPdf() {
    if (!lastRun) return;
    pdfBtn.disabled = true;
    const originalLabel = pdfBtn.innerHTML;
    pdfBtn.textContent = "กำลังสร้าง PDF...";
    pdfMsg.hidden = true;

    try {
      // ดึงรายการเต็ม (มีรูปถ่ายจริง/รูปวิเคราะห์ ที่ fetchHistory แบบ list ไม่ได้ส่งมาด้วย) เอาไปแสดงใน PDF
      const [fullCurrent, fullBaseline] = await Promise.all([
        fetchHistoryItem(lastRun.currentItem.id),
        fetchHistoryItem(lastRun.baselineItem.id),
      ]);
      await downloadComparisonReportPdf({
        displayLabel: selectedDisplayLabel(),
        patternLabel: patternsData[patternSelect.value]?.label || patternSelect.value,
        currentItem: { ...lastRun.currentItem, ...fullCurrent },
        baselineItem: { ...lastRun.baselineItem, ...fullBaseline },
        comparisons: lastRun.comparisons,
        overallOutcome: lastRun.overallOutcome,
      });
    } catch (e) {
      pdfMsg.textContent = "สร้างไฟล์ PDF ไม่สำเร็จ";
      pdfMsg.hidden = false;
    } finally {
      pdfBtn.disabled = false;
      pdfBtn.innerHTML = originalLabel;
    }
  }

  displaySelect.addEventListener("change", handleDisplayChange);
  patternSelect.addEventListener("change", handlePatternChange);
  currentSelect.addEventListener("change", handleCurrentChange);
  baselineSelect.addEventListener("change", handleBaselineChange);
  runBtn.addEventListener("click", handleRun);
  pdfBtn.addEventListener("click", handleDownloadPdf);
  backBtn.addEventListener("click", () => onBack());

  return {
    load,
  };
}
