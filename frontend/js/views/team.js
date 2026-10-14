export function initTeam({ onBack }) {
  const backBtn = document.getElementById("team-back-btn");
  backBtn.addEventListener("click", () => onBack());
}
