export function initTestset({ onBack }) {
  const backBtn = document.getElementById("testset-back-btn");
  backBtn.addEventListener("click", () => onBack());
}
