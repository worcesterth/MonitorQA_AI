import { fetchHistory, fetchHistoryItem } from "../api.js";
import { formatDate, criterionRowsHtml } from "../utils.js";
import { downloadReportPdf } from "../pdfReport.js";
import { wireLoginGate } from "../authGate.js";

export function initHistory({ onBack, onSignup } = {}) {
  const contentEl = document.getElementById("history-content");

  const historyList = document.getElementById("history-list");
  const historyEmpty = document.getElementById("history-empty");
  const historyBackBtn = document.getElementById("history-back-btn");

  const filterBtn = document.getElementById("history-filter-btn");
  const filterDot = document.getElementById("history-filter-dot");
  const sortOverlay = document.getElementById("sort-overlay");
  const sortSheet = document.getElementById("sort-sheet");
  const sortSheetClose = document.getElementById("sort-sheet-close");
  const dateFromInput = document.getElementById("filter-date-from");
  const dateToInput = document.getElementById("filter-date-to");
  const testerListEl = document.getElementById("filter-tester-list");
  const displayListEl = document.getElementById("filter-display-list");
  const patternListEl = document.getElementById("filter-pattern-list");
  const resultChecks = [...document.querySelectorAll('[data-filter="result"]')];
  const clearBtn = document.getElementById("filter-clear-btn");
  const applyBtn = document.getElementById("filter-apply-btn");

  let items = [];
  let filters = { dateFrom: "", dateTo: "", testers: [], displays: [], patterns: [], results: [] };

  /** คำนวณ "ครั้งที่" ของแต่ละรายการ — นับแยกกันตามจอภาพ + ชุดทดสอบ ตามลำดับเวลาจริง
   *  คืน Map จาก item.id -> ครั้งที่ */
  function computeAttemptNumbers(list) {
    const groups = new Map();
    list.forEach((it) => {
      const key = `${it.display_label || ""}|${it.pattern}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(it);
    });
    const numbers = new Map();
    groups.forEach((group) => {
      group
        .slice()
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id)
        .forEach((it, idx) => numbers.set(it.id, idx + 1));
    });
    return numbers;
  }

  function cardHtml(item, attemptNumber) {
    const cls = item.overall === "Pass" ? "pass" : "fail";
    const labelTh = item.overall === "Pass" ? "ผ่าน" : "ไม่ผ่าน";
    const phoneTxt = item.phone && item.phone !== "unknown" ? ` · ${item.phone}` : "";
    const testerTxt = item.tested_by ? ` · ทดสอบโดย ${item.tested_by}` : "";
    const displayTxt = item.display_label ? ` · จอ ${item.display_label}` : "";
    const attemptTxt = attemptNumber ? ` · ครั้งที่ ${attemptNumber}` : "";
    return `
      <div class="history-card" data-id="${item.id}">
        <div class="history-card__top">
          <div>
            <div class="history-card__pattern">${item.pattern_label}</div>
            <div class="history-card__meta">${formatDate(item.created_at)}${displayTxt}${attemptTxt}${testerTxt}${phoneTxt}</div>
          </div>
          <span class="history-card__badge ${cls}">${labelTh}</span>
        </div>
        <div class="history-card__detail" hidden>
          <button class="btn btn--outline history-card__pdf-btn" data-action="download-pdf">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="M12 3v12m0 0l-4-4m4 4l4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>
            ดาวน์โหลด PDF
          </button>
          <p class="error-msg history-card__pdf-msg" hidden></p>
          ${criterionRowsHtml(item.results)}
        </div>
      </div>`;
  }

  function applyFilters(list) {
    return list.filter((item) => {
      if (filters.dateFrom && item.created_at.slice(0, 10) < filters.dateFrom) return false;
      if (filters.dateTo && item.created_at.slice(0, 10) > filters.dateTo) return false;
      if (filters.testers.length && !filters.testers.includes(item.tested_by || "")) return false;
      if (filters.displays.length && !filters.displays.includes(item.display_label || "")) return false;
      if (filters.patterns.length && !filters.patterns.includes(item.pattern_label || "")) return false;
      if (filters.results.length && !filters.results.includes(item.overall)) return false;
      return true;
    });
  }

  function hasActiveFilters() {
    return (
      filters.dateFrom ||
      filters.dateTo ||
      filters.testers.length ||
      filters.displays.length ||
      filters.patterns.length ||
      filters.results.length
    );
  }

  function render() {
    const filtered = applyFilters(items);
    const attemptNumbers = computeAttemptNumbers(items);
    historyEmpty.hidden = filtered.length > 0;
    historyList.innerHTML = filtered.map((item) => cardHtml(item, attemptNumbers.get(item.id))).join("");

    historyList.querySelectorAll(".history-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const pdfBtn = e.target.closest('[data-action="download-pdf"]');
        if (pdfBtn) {
          e.stopPropagation();
          const id = Number(card.dataset.id);
          const item = items.find((it) => it.id === id);
          if (item) handleDownloadPdf(item, pdfBtn);
          return;
        }
        const detail = card.querySelector(".history-card__detail");
        detail.hidden = !detail.hidden;
      });
    });

    filterDot.hidden = !hasActiveFilters();
  }

  async function handleDownloadPdf(item, btn) {
    btn.disabled = true;
    const originalLabel = btn.innerHTML;
    btn.textContent = "กำลังสร้าง PDF...";
    const msgEl = btn.parentElement.querySelector(".history-card__pdf-msg");
    msgEl.hidden = true;

    try {
      const full = await fetchHistoryItem(item.id); // รายการเดียวมีรูปถ่ายจริง/รูปวิเคราะห์ติดมาด้วย (fetchHistory ปกติไม่มี)
      await downloadReportPdf({
        result: full,
        displayLabel: full.display_label,
        historyId: full.id,
        rawImage: full.raw_image || null,
      });
    } catch (e) {
      msgEl.textContent = "สร้างไฟล์ PDF ไม่สำเร็จ";
      msgEl.hidden = false;
    } finally {
      btn.disabled = false;
      btn.innerHTML = originalLabel;
    }
  }

  /* ---------- เข้าสู่ระบบก่อนดูประวัติ — เห็นเฉพาะรายการของบัญชีตัวเองเท่านั้น ---------- */

  const gate = wireLoginGate({
    prefix: "history",
    onBack,
    onSignup,
    onEnter: async (user) => {
      if (!user) {
        contentEl.hidden = true;
        return;
      }
      contentEl.hidden = false;
      historyList.innerHTML = "";
      try {
        const all = await fetchHistory(1000);
        items = all.filter((it) => it.tested_by === user.full_name); // เห็นเฉพาะของบัญชีตัวเองเท่านั้น
        render();
      } catch (e) {
        historyEmpty.hidden = false;
      }
    },
  });

  async function load() {
    await gate.enter();
  }

  /* ---------- ชีทกรองข้อมูล ---------- */

  function uniqueValues(field) {
    return [...new Set(items.map((it) => it[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "th"));
  }

  function checkboxHtml(name, value) {
    return `<label class="filter-check"><input type="checkbox" value="${value}" data-filter="${name}"><span>${value}</span></label>`;
  }

  function renderFilterLists() {
    testerListEl.innerHTML = uniqueValues("tested_by").map((v) => checkboxHtml("tester", v)).join("");
    displayListEl.innerHTML = uniqueValues("display_label").map((v) => checkboxHtml("display", v)).join("");
    patternListEl.innerHTML = uniqueValues("pattern_label").map((v) => checkboxHtml("pattern", v)).join("");
  }

  function syncFormFromFilters() {
    dateFromInput.value = filters.dateFrom;
    dateToInput.value = filters.dateTo;
    [...document.querySelectorAll('[data-filter="tester"]')].forEach((el) => (el.checked = filters.testers.includes(el.value)));
    [...document.querySelectorAll('[data-filter="display"]')].forEach((el) => (el.checked = filters.displays.includes(el.value)));
    [...document.querySelectorAll('[data-filter="pattern"]')].forEach((el) => (el.checked = filters.patterns.includes(el.value)));
    resultChecks.forEach((el) => (el.checked = filters.results.includes(el.value)));
  }

  function openSheet() {
    renderFilterLists();
    syncFormFromFilters();
    sortOverlay.hidden = false;
    sortSheet.hidden = false;
    requestAnimationFrame(() => {
      sortOverlay.classList.add("is-open");
      sortSheet.classList.add("is-open");
    });
  }

  function closeSheet() {
    sortOverlay.classList.remove("is-open");
    sortSheet.classList.remove("is-open");
    setTimeout(() => {
      sortOverlay.hidden = true;
      sortSheet.hidden = true;
    }, 220);
  }

  function checkedValues(name) {
    return [...document.querySelectorAll(`[data-filter="${name}"]:checked`)].map((el) => el.value);
  }

  filterBtn.addEventListener("click", openSheet);
  sortSheetClose.addEventListener("click", closeSheet);
  sortOverlay.addEventListener("click", closeSheet);

  applyBtn.addEventListener("click", () => {
    filters = {
      dateFrom: dateFromInput.value || "",
      dateTo: dateToInput.value || "",
      testers: checkedValues("tester"),
      displays: checkedValues("display"),
      patterns: checkedValues("pattern"),
      results: checkedValues("result"),
    };
    render();
    closeSheet();
  });

  clearBtn.addEventListener("click", () => {
    filters = { dateFrom: "", dateTo: "", testers: [], displays: [], patterns: [], results: [] };
    syncFormFromFilters();
  });

  historyBackBtn.addEventListener("click", () => onBack?.());

  return { load };
}
