import { fetchHistory, fetchDisplays } from "./api.js";
import { formatThaiDateTime, modeColorTableHtml } from "./utils.js";

const RESULT_LABEL_TH = { Pass: "ผ่าน", Fail: "ไม่ผ่าน" };

function resultRowHtml(r) {
  const labelTh = RESULT_LABEL_TH[r.label] || "N/A";
  const cellCls =
    r.label === "Pass" ? "pdf-report__result-cell--pass" : r.label === "Fail" ? "pdf-report__result-cell--fail" : "pdf-report__result-cell--na";
  const note = r.warning || "";
  return `
    <tr>
      <td>${r.name}</td>
      <td class="pdf-report__result-cell ${cellCls}">${labelTh}</td>
      <td>${note}</td>
    </tr>`;
}

/** ตาราง mode01-16 แบบมีสี (TG18-CT) — โชว์ต่อจากตารางผลหลักถ้าเกณฑ์ไหนมีค่า mode ติดมาด้วย
 *  ใช้ modeColorTableHtml เดียวกับที่หน้าแอปใช้ (utils.js) ให้สีตรงกับที่เห็นในแอปเป๊ะ */
function modeTablesHtml(results) {
  return results
    .filter((r) => r.features && Object.keys(r.features).some((k) => /^p\d+_mode$/.test(k)))
    .map((r) => {
      const modeKeys = Object.keys(r.features)
        .filter((k) => /^p\d+_mode$/.test(k))
        .sort();
      return `
        <p class="pdf-report__mode-title">ค่า mode01–16 ของ "${r.name}"</p>
        ${modeColorTableHtml(modeKeys, r.features)}`;
    })
    .join("");
}

function buildReportHtml({ result, displayLabel, info, attemptNumber, rawImage }) {
  const hospital = info.location || "";
  const brandModel = info.brand_model || displayLabel || "—";
  const assetNumber = info.asset_number || "—";
  const tester = result.tested_by || "—";
  const overallCls = result.overall === "Pass" ? "pdf-report__overall--pass" : "pdf-report__overall--fail";
  const overallTh = RESULT_LABEL_TH[result.overall] || result.overall;

  const photoHtml = rawImage
    ? `<div class="pdf-report__photos"><div class="pdf-report__photo-col"><p class="pdf-report__photo-label">รูปถ่ายจริง</p><div class="pdf-report__photo-frame pdf-report__photo-frame--large"><img class="pdf-report__photo" src="${rawImage}"></div></div></div>`
    : "";

  return `
    <div class="pdf-report">
      <h1 class="pdf-report__title">รายงานผลการประเมินคุณภาพจอแสดงผลทางการแพทย์</h1>
      <p class="pdf-report__line">โรงพยาบาล: ${hospital}</p>
      <p class="pdf-report__line">จอภาพ: ${brandModel} | ครั้งที่ ${attemptNumber} | หมายเลขครุภัณฑ์ ${assetNumber} | ผู้ประเมิน ${tester} | ชุดทดสอบ ${result.pattern_label || result.pattern} | ${formatThaiDateTime(result.created_at)}</p>
      <p class="pdf-report__overall ${overallCls}">ผลรวม: ${overallTh}</p>
      <table>
        <thead>
          <tr><th>หัวข้อการประเมิน</th><th style="width:90px;">ผลการประเมิน</th><th style="width:220px;">หมายเหตุ</th></tr>
        </thead>
        <tbody>${result.results.map(resultRowHtml).join("")}</tbody>
      </table>
      ${modeTablesHtml(result.results)}
      ${photoHtml}
      <p class="pdf-report__disclaimer"><strong>หมายเหตุ</strong><br>การประเมินในระบบนี้อ้างอิงจากการวิเคราะห์ภาพถ่ายจากสมาร์ทโฟนด้วยแบบจำลอง ซึ่งอาจแตกต่างจากการประเมินด้วยสายตาของผู้เชี่ยวชาญที่พิจารณาจากจอแสดงผลโดยตรง ผลการประเมินจึงมีวัตถุประสงค์เพื่อการศึกษาและการคัดกรองเบื้องต้นเท่านั้น</p>
      <div class="pdf-report__sign">
        <p>ลงชื่อ ....................................................</p>
        <p>( ${tester} )</p>
        <p>ผู้ประเมิน</p>
      </div>
    </div>`;
}

function comparisonResultCellHtml(label) {
  const cls = label === "Pass" ? "pdf-report__result-cell--pass" : label === "Fail" ? "pdf-report__result-cell--fail" : "pdf-report__result-cell--na";
  return `<td class="pdf-report__result-cell ${cls}">${RESULT_LABEL_TH[label] || label}</td>`;
}

function comparisonRowHtml(c) {
  return `
    <tr>
      <td>${c.name}</td>
      ${comparisonResultCellHtml(c.bLabel)}
      ${comparisonResultCellHtml(c.cLabel)}
      <td>${c.outcome.verdict}</td>
      <td>${c.outcome.desc}</td>
    </tr>`;
}

/** คอลัมน์รูปของ 1 ครั้ง (baseline หรือครั้งนี้) — โชว์แค่รูปถ่ายจริง (ตัดรูปที่วิเคราะห์ออก) ถ้าไม่มีรูปเลย
 *  (ประวัติเก่าก่อนมีระบบเก็บรูป) คืนค่าว่าง */
function comparisonPhotoColumn(label, item) {
  if (!item.raw_image) return "";
  return `<div class="pdf-report__photo-col"><p class="pdf-report__photo-label">${label}</p><div class="pdf-report__photo-frame pdf-report__photo-frame--medium"><img class="pdf-report__photo" src="${item.raw_image}"></div></div>`;
}

/** หาผลของเกณฑ์ที่มีค่า mode01-16 (TG18-CT) จาก results เต็มของ 1 ครั้ง */
function findModeResult(item) {
  return (item.results || []).find((r) => r.features && Object.keys(r.features).some((k) => /^p\d+_mode$/.test(k))) || null;
}

/** ตาราง mode01-16 แบบมีสี ของ baseline กับครั้งนี้วางเทียบกัน (เฉพาะ TG18-CT ที่มีค่า mode ติดมาด้วย) */
function modeTablesComparisonHtml(baselineItem, currentItem) {
  const baseR = findModeResult(baselineItem);
  const curR = findModeResult(currentItem);
  if (!baseR && !curR) return "";

  const col = (label, r) => {
    if (!r) return "";
    const modeKeys = Object.keys(r.features)
      .filter((k) => /^p\d+_mode$/.test(k))
      .sort();
    return `<div class="pdf-report__mode-col"><p class="pdf-report__mode-title">${label} — ค่า mode01–16</p>${modeColorTableHtml(modeKeys, r.features)}</div>`;
  };

  const baseHtml = col(`Baseline (ครั้งที่ ${baselineItem.attemptNumber})`, baseR);
  const curHtml = col(`ครั้งนี้ (ครั้งที่ ${currentItem.attemptNumber})`, curR);
  return `<div class="pdf-report__mode-row">${baseHtml}${curHtml}</div>`;
}

function buildComparisonReportHtml({ displayLabel, info, patternLabel, currentItem, baselineItem, comparisons, overallOutcome }) {
  const hospital = info.location || "";
  const brandModel = info.brand_model || displayLabel || "—";
  const assetNumber = info.asset_number || "—";
  const tester = currentItem.tested_by || "—";
  // "same" ไม่ได้แปลว่า "ดี" เสมอไป (อาจเป็นไม่ผ่านทั้งคู่ก็ได้) จึงใช้สีกลาง ไม่ใช้เขียว/แดงจนกว่าจะรู้ผลจริง
  const overallCls =
    overallOutcome.code === "degraded" ? "pdf-report__overall--fail" : overallOutcome.code === "drift" ? "pdf-report__overall--drift" : "";

  const baselineCol = comparisonPhotoColumn(`Baseline (ครั้งที่ ${baselineItem.attemptNumber})`, baselineItem);
  const currentCol = comparisonPhotoColumn(`ครั้งนี้ (ครั้งที่ ${currentItem.attemptNumber})`, currentItem);
  const photoHtml = baselineCol || currentCol ? `<div class="pdf-report__photos">${baselineCol}${currentCol}</div>` : "";

  return `
    <div class="pdf-report">
      <h1 class="pdf-report__title">รายงานผลการเปรียบเทียบการทดสอบ</h1>
      <p class="pdf-report__line">โรงพยาบาล: ${hospital}</p>
      <p class="pdf-report__line">จอภาพ: ${brandModel} | หมายเลขครุภัณฑ์ ${assetNumber} | ชุดทดสอบ ${patternLabel}</p>
      <p class="pdf-report__line">ครั้งนี้: ครั้งที่ ${currentItem.attemptNumber} | ผู้ประเมิน ${currentItem.tested_by || "—"} | ${formatThaiDateTime(currentItem.created_at)}</p>
      <p class="pdf-report__line">Baseline: ครั้งที่ ${baselineItem.attemptNumber} | ผู้ประเมิน ${baselineItem.tested_by || "—"} | ${formatThaiDateTime(baselineItem.created_at)}</p>
      <p class="pdf-report__overall ${overallCls}">ภาพรวม (สรุปจาก ${comparisons.length} เกณฑ์): ${overallOutcome.verdict}</p>
      <table>
        <thead>
          <tr>
            <th>หัวข้อประเมิน</th>
            <th style="width:80px;">Baseline</th>
            <th style="width:80px;">ครั้งนี้</th>
            <th style="width:150px;">ผลการเปรียบเทียบ</th>
            <th>คำอธิบายเพิ่มเติม</th>
          </tr>
        </thead>
        <tbody>${comparisons.map(comparisonRowHtml).join("")}</tbody>
      </table>
      ${modeTablesComparisonHtml(baselineItem, currentItem)}
      ${photoHtml}
      <p class="pdf-report__disclaimer"><strong>หมายเหตุ</strong><br>การประเมินในระบบนี้อ้างอิงจากการวิเคราะห์ภาพถ่ายจากสมาร์ทโฟนด้วยแบบจำลอง ซึ่งอาจแตกต่างจากการประเมินด้วยสายตาของผู้เชี่ยวชาญที่พิจารณาจากจอแสดงผลโดยตรง ผลการประเมินจึงมีวัตถุประสงค์เพื่อการศึกษาและการคัดกรองเบื้องต้นเท่านั้น</p>
      <div class="pdf-report__sign">
        <p>ลงชื่อ ....................................................</p>
        <p>( ${tester} )</p>
        <p>ผู้ประเมิน</p>
      </div>
    </div>`;
}

function waitForImages(root) {
  const imgs = [...root.querySelectorAll("img")];
  return Promise.all(
    imgs.map((img) =>
      img.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          })
    )
  );
}

/** หาข้อมูลจอภาพ (โรงพยาบาล/รุ่น/ครุภัณฑ์) จากรายชื่อจอที่ลงทะเบียนไว้ โดยจับคู่จาก display_label ที่บันทึกไว้
 *  เผื่อจอถูกลบ/แก้ไขไปแล้ว จะ parse ข้อความ display_label เป็น fallback แทน */
async function resolveDisplayInfo(displayLabel) {
  if (!displayLabel) return { location: "", brand_model: "", asset_number: "" };
  try {
    const displays = await fetchDisplays(200);
    const match = displays.find((d) => `${d.brand_model} (ครุภัณฑ์ ${d.asset_number})` === displayLabel);
    if (match) return match;
  } catch (e) {
    /* ตกไปใช้วิธี parse ข้อความแทน */
  }
  const m = displayLabel.match(/^(.*)\s\(ครุภัณฑ์\s*(.+)\)$/);
  return m ? { location: "", brand_model: m[1], asset_number: m[2] } : { location: "", brand_model: displayLabel, asset_number: "" };
}

/** นับว่าเป็นการทดสอบ "ครั้งที่" เท่าไรของจอนี้ — นับแยกกันตามชุดทดสอบ (pattern)
 *  ถ้าระบุ historyId มา (ดาวน์โหลดจากรายการประวัติเดิม) จะคำนวณตามลำดับเวลาจริงตอนนั้น
 *  ไม่ใช่นับจากจำนวนรายการทั้งหมด ณ ตอนนี้ เพื่อให้เลขคงที่ไม่เปลี่ยนไปตามเวลาที่กดโหลดซ้ำ */
async function computeAttemptNumber({ displayLabel, pattern, historyId }) {
  try {
    const history = await fetchHistory(1000);
    const matching = history
      .filter((h) => h.display_label === displayLabel && h.pattern === pattern)
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);
    if (historyId != null) {
      const idx = matching.findIndex((h) => h.id === historyId);
      return idx >= 0 ? idx + 1 : matching.length + 1;
    }
    return matching.length + 1;
  } catch (e) {
    return 1;
  }
}

/**
 * สร้าง+ดาวน์โหลดรายงาน PDF ของผลทดสอบ — ใช้ร่วมกันทั้งหน้าผลลัพธ์ (หลังวิเคราะห์เสร็จทันที) และหน้าประวัติ
 *
 * result: {pattern, pattern_label, tested_by, overall, results, processed_image (ไม่บังคับ — ประวัติเก่าไม่มีรูปเก็บไว้), created_at}
 * displayLabel: ข้อความจอภาพที่ format ไว้แล้ว เช่น "Eizo (ครุภัณฑ์ 1234444)"
 * displayInfo: {location, brand_model, asset_number} — ถ้ามีอยู่แล้ว (หน้าผลลัพธ์ทันทีหลังวิเคราะห์) ไม่ต้อง fetch ซ้ำ
 * historyId: ระบุถ้าดาวน์โหลดจากรายการประวัติเดิม เพื่อคำนวณครั้งที่ตามลำดับเวลาจริง
 * rawImage: data URL ของรูปถ่ายจริงที่ผู้ใช้อัปโหลด (ไม่บังคับ — มีเฉพาะตอนดาวน์โหลดจากหน้าผลลัพธ์ทันที
 *   เพราะไม่ได้เก็บรูปดิบไว้ใน DB ประวัติ) แสดงคู่กับรูปที่วิเคราะห์แบบซ้าย-ขวา
 */
export async function downloadReportPdf({ result, displayLabel, displayInfo, historyId, rawImage }) {
  if (!window.html2canvas || !window.jspdf) throw new Error("โหลดไลบรารีสร้าง PDF ไม่สำเร็จ");
  const pdfRoot = document.getElementById("pdf-report-root");
  const info = displayInfo || (await resolveDisplayInfo(displayLabel));
  const attemptNumber = await computeAttemptNumber({ displayLabel, pattern: result.pattern, historyId });

  pdfRoot.innerHTML = buildReportHtml({ result, displayLabel, info, attemptNumber, rawImage });
  const displayName = (info.brand_model || displayLabel || "display").replace(/[^a-zA-Z0-9ก-๙]+/g, "_");
  await rasterizeAndSave(pdfRoot, `report_${displayName}_${result.pattern}_ครั้งที่${attemptNumber}.pdf`);
}

/**
 * สร้าง+ดาวน์โหลดรายงาน PDF เปรียบเทียบผล 2 ครั้ง — ใช้จากหน้า "เปรียบเทียบผลการทดสอบ" หลังกด "เปรียบเทียบ"
 *
 * displayLabel/displayInfo: เหมือน downloadReportPdf
 * patternLabel: ชื่อชุดทดสอบที่ใช้แสดง
 * currentItem/baselineItem: {attemptNumber, tested_by, created_at}
 * comparisons: [{name, outcome: {verdict, code, desc}, bLabel, cLabel}] — ผลเทียบรายเกณฑ์ (ได้จาก compare.js)
 * overallOutcome: {verdict, code, desc} — สรุปภาพรวมจาก comparisons
 */
export async function downloadComparisonReportPdf({ displayLabel, displayInfo, patternLabel, currentItem, baselineItem, comparisons, overallOutcome }) {
  if (!window.html2canvas || !window.jspdf) throw new Error("โหลดไลบรารีสร้าง PDF ไม่สำเร็จ");
  const pdfRoot = document.getElementById("pdf-report-root");
  const info = displayInfo || (await resolveDisplayInfo(displayLabel));

  pdfRoot.innerHTML = buildComparisonReportHtml({ displayLabel, info, patternLabel, currentItem, baselineItem, comparisons, overallOutcome });
  const displayName = (info.brand_model || displayLabel || "display").replace(/[^a-zA-Z0-9ก-๙]+/g, "_");
  await rasterizeAndSave(pdfRoot, `เปรียบเทียบ_${displayName}_${patternLabel}_ครั้งที่${currentItem.attemptNumber}_vs_${baselineItem.attemptNumber}.pdf`);
}

/** rasterize เนื้อหาใน pdfRoot ด้วย html2canvas แล้วใส่ลง PDF หน้าเดียวเสมอด้วย jsPDF (ถ้าเนื้อหาสูงเกิน
 *  1 หน้า A4 จะย่อภาพทั้งหมดลงให้พอดีความสูงหน้าแทนการขึ้นหน้าใหม่ — การ์ดผลลัพธ์/เปรียบเทียบถูกออกแบบ
 *  ให้กระชับพอสำหรับ 1 หน้าอยู่แล้ว การย่อนี้เป็นตาข่ายนิรภัยกันกรณีเนื้อหายาวผิดปกติเท่านั้น) แล้ว save
 *  เป็นไฟล์, ล้าง pdfRoot ทิ้ง */
async function rasterizeAndSave(pdfRoot, filename) {
  await waitForImages(pdfRoot);
  // กัน capture ก่อนฟอนต์ Sarabun โหลดเสร็จ (ทำให้ fallback เป็นฟอนต์ default ขนาด/รูปแบบตัวอักษรเพี้ยน —
  // เกิดง่ายบนมือถือที่เน็ตช้ากว่าคอม เช่นต่อผ่าน hotspot) โหลดทุกน้ำหนักที่ใช้จริงในรายงานให้ครบ
  // (400/500/600/700 — ไม่ใช่แค่ 400/700) เผื่อ document.fonts.ready เสร็จก่อนไฟล์ฟอนต์บางน้ำหนักโหลดจริง
  try {
    await Promise.all(
      [400, 500, 600, 700].map((w) => document.fonts.load(`${w} 12px "Sarabun"`))
    );
  } catch (e) {
    /* โหลดฟอนต์ไม่สำเร็จ — ปล่อยผ่าน ใช้ fallback ที่เหลือ */
  }
  if (document.fonts?.ready) await document.fonts.ready;
  // เผื่อ fonts.ready resolve ก่อน layout/reflow ที่ใช้ฟอนต์ใหม่จะวาดเสร็จจริง (เจอบ่อยบนมือถือที่ช้ากว่า) —
  // รอ 2 animation frame ให้ browser paint รอบใหม่ด้วยฟอนต์ที่โหลดเสร็จแล้วก่อนค่อย capture
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  const reportEl = pdfRoot.querySelector(".pdf-report");
  const canvas = await window.html2canvas(reportEl, { scale: 2.2, useCORS: true, backgroundColor: "#ffffff" });

  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const fullWidthImgHeight = (canvas.height * pageWidth) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  if (fullWidthImgHeight <= pageHeight) {
    pdf.addImage(imgData, "JPEG", 0, 0, pageWidth, fullWidthImgHeight);
  } else {
    // เนื้อหายาวเกิน 1 หน้า A4 พอดี — ย่อสัดส่วนทั้งภาพลงให้สูงพอดีหน้าเดียวเสมอ (ไม่ขึ้นหน้าที่ 2)
    const scaledWidth = pageWidth * (pageHeight / fullWidthImgHeight);
    const xOffset = (pageWidth - scaledWidth) / 2;
    pdf.addImage(imgData, "JPEG", xOffset, 0, scaledWidth, pageHeight);
  }

  pdf.save(filename);
  pdfRoot.innerHTML = "";
}
