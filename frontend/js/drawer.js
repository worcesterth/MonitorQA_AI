/** เปิด/ปิดเมนู hamburger (overlay + แผงเลื่อนจากขวา) */
export function createDrawer() {
  const overlay = document.getElementById("menu-overlay");
  const drawer = document.getElementById("drawer");
  const openBtn = document.getElementById("menu-toggle");
  const closeBtn = document.getElementById("drawer-close");

  function open() {
    overlay.hidden = false;
    drawer.hidden = false;
    openBtn.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => {
      overlay.classList.add("is-open");
      drawer.classList.add("is-open");
    });
  }

  function close() {
    overlay.classList.remove("is-open");
    drawer.classList.remove("is-open");
    openBtn.setAttribute("aria-expanded", "false");
    setTimeout(() => {
      overlay.hidden = true;
      drawer.hidden = true;
    }, 220);
  }

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", close);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  return { open, close };
}
