export function initReference({ onBack }) {
  const backBtn = document.getElementById("reference-back-btn");
  backBtn.addEventListener("click", () => onBack());
}
