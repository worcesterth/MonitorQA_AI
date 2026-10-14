export function initGuide({ onStart, onBack }) {
  const startBtn = document.getElementById("guide-start-btn");
  const backBtn = document.getElementById("guide-back-btn");
  startBtn.addEventListener("click", () => onStart());
  backBtn.addEventListener("click", () => onBack());
}
