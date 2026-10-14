export function initHome({ onStart, onRegister, onReference, onTeam, onTestset, onFaq }) {
  const startBtn = document.getElementById("hero-start-btn");
  const registerBtn = document.getElementById("hero-register-btn");
  const referenceLink = document.getElementById("home-reference-link");
  const teamLink = document.getElementById("home-team-link");
  const faqLink = document.getElementById("home-faq-link");
  const detailLink = document.getElementById("hero-detail-link");
  startBtn.addEventListener("click", () => onStart());
  registerBtn.addEventListener("click", () => onRegister());
  referenceLink.addEventListener("click", () => onReference());
  teamLink.addEventListener("click", () => onTeam());
  faqLink.addEventListener("click", () => onFaq());
  detailLink.addEventListener("click", (e) => {
    e.preventDefault();
    onTestset();
  });
}
