export function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString("th-TH", { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

export function formatDateOnly(iso) {
  try {
    return new Date(iso).toLocaleDateString("th-TH", { dateStyle: "medium" });
  } catch {
    return iso;
  }
}

export function formatTimeOnly(iso) {
  try {
    return new Date(iso).toLocaleTimeString("th-TH", { timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** DD/MM/YYYY HH:MM:SS แบบ พ.ศ. — ใช้กับหัวรายงาน PDF ให้ตรงรูปแบบเอกสารทางการ */
export function formatThaiDateTime(iso) {
  try {
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    const buddhistYear = d.getFullYear() + 543;
    return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${buddhistYear} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

/** ตาราง mode01–16 (TG18-CT) แบบมีสี — จัดเป็น 4 แถวตามตำแหน่งจริงของแพตช์บนจอ แต่ละแพตช์ใช้ 2 คอลัมน์
 *  แยกกัน (ช่องสีตามค่าความสว่างจริง + ช่องตัวเลข) รวม 4 แพตช์/แถว x 2 คอลัมน์ = 4 แถว x 8 คอลัมน์
 *  ให้เทียบสีที่เห็นกับตัวเลขที่คำนวณได้แบบเคียงข้างกันตรงๆ */
export function modeColorTableHtml(modeKeys, features) {
  const values = modeKeys.map((k) => features[k]);
  let rowsHtml = "";
  for (let r = 0; r < 4; r++) {
    let cellsHtml = "";
    for (let c = 0; c < 4; c++) {
      const v = values[r * 4 + c];
      if (v == null) continue;
      cellsHtml += `<td class="mode-color-cell" style="background:rgb(${v},${v},${v});"></td>`;
      cellsHtml += `<td class="mode-value-cell">${v}</td>`;
    }
    rowsHtml += `<tr>${cellsHtml}</tr>`;
  }
  return `<table class="mode-color-table">${rowsHtml}</table>`;
}

/** ค่า mode01-16 / dmode01-15 ที่คำนวณได้ (ถ้ามี) — พับเก็บไว้ในตัว <details> */
function featuresHtml(features) {
  if (!features) return "";
  const modeKeys = Object.keys(features)
    .filter((k) => /^p\d+_mode$/.test(k))
    .sort();
  const dmodeKeys = Object.keys(features)
    .filter((k) => /^dmode\d+$/.test(k))
    .sort();
  if (!modeKeys.length && !dmodeKeys.length) return "";

  const cell = (label, value) =>
    `<div class="feature-cell"><span class="feature-cell__label">${label}</span><span class="feature-cell__value">${value}</span></div>`;

  const modeHtml = modeColorTableHtml(modeKeys, features);
  const dmodeCells = dmodeKeys.map((k, i) => cell(`d${String(i + 1).padStart(2, "0")}`, features[k])).join("");

  return `
    <details class="result-row__features">
      <summary>ดูค่า mode / dmode ที่คำนวณได้</summary>
      <div class="feature-group-label">mode01–16 (ค่าพิกเซลที่พบมากสุดในแต่ละแพตช์ — สีช่องตรงกับค่าความสว่างจริง)</div>
      ${modeHtml}
      <div class="feature-group-label">dmode01–15 (ผลต่างระหว่างแพตช์ถัดกัน)</div>
      <div class="feature-grid feature-grid--dmode">${dmodeCells}</div>
    </details>`;
}

/** แถวผลลัพธ์รายเกณฑ์ — ใช้ร่วมกันทั้งหน้าทดสอบและหน้าประวัติ */
export function criterionRowsHtml(results) {
  return results
    .map((r) => {
      const cls = r.label === "Pass" ? "pass" : r.label === "Fail" ? "fail" : "na";
      const labelTh = r.label === "Pass" ? "ผ่าน" : r.label === "Fail" ? "ไม่ผ่าน" : "N/A";
      const confTxt = r.confidence != null ? ` · ค่าความเชื่อมั่น ${(r.confidence * 100).toFixed(1)}%` : "";
      const warningHtml = r.warning ? `<p class="result-row__warning">⚠️ ${r.warning}</p>` : "";
      const numberBadge = r.index != null ? `<span class="result-row__number">${r.index}</span>` : "";
      return `
        <div class="result-row ${cls}">
          <div>
            <span class="result-row__name">${numberBadge}${r.name}</span>
            <span class="result-row__crit">${r.criterion}${confTxt}</span>
            ${warningHtml}
            ${featuresHtml(r.features)}
          </div>
          <span class="result-row__label ${cls}">${labelTh}</span>
        </div>`;
    })
    .join("");
}
