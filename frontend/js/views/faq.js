export function initFaq({ onBack }) {
  const backBtn = document.getElementById("faq-back-btn");
  backBtn.addEventListener("click", () => onBack());
}
