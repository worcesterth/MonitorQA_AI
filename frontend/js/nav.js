/**
 * ตัวจัดการสลับหน้า (view) ผ่าน tabbar ด้านล่าง
 * แต่ละหน้าคือ <section class="view" id="view-<name>"> + ปุ่ม id="tab-<name>" data-view="<name>" (ไม่บังคับ —
 * บางหน้า เช่น คู่มือ ไม่มีปุ่มใน drawer เข้าถึงได้แค่ผ่าน flow ในแอปเท่านั้น)
 *
 * tabTargets: { tabName: "actualViewName" } — ให้ปุ่มใน drawer พาไปหน้าอื่นแทนหน้าตัวเอง
 * เช่น tab-check พาไปหน้า guide ก่อน (ให้อ่านคู่มือก่อนเริ่มทดสอบทุกครั้ง)
 *
 * ผูกกับ History API (pushState/popstate) ด้วย — เดิมสลับหน้าด้วยการซ่อน/โชว์ section เฉยๆ ไม่แตะ
 * browser history เลย ทำให้ทั้งแอปมี history entry เดียว กดปุ่มย้อนกลับของเบราว์เซอร์/มือถือทีเดียว
 * หลุดออกจากเว็บไปเลยแทนที่จะย้อนไปหน้าก่อนหน้าในแอป — switchTo ทุกครั้งจึง pushState ไปด้วย แล้วฟัง
 * popstate เพื่อ sync กลับมาที่ view เดิมตอนกดปุ่มย้อนกลับ
 */
export function createNav(viewNames, { onActivate, tabTargets = {} } = {}) {
  const views = Object.fromEntries(viewNames.map((name) => [name, document.getElementById(`view-${name}`)]));
  const tabs = Object.fromEntries(viewNames.map((name) => [name, document.getElementById(`tab-${name}`)]));
  let currentView = null;

  function render(name) {
    if (!views[name]) return;
    viewNames.forEach((n) => {
      views[n].hidden = n !== name;
      tabs[n]?.classList.toggle("is-active", n === name);
    });
    currentView = name;
    onActivate?.(name);
  }

  function switchTo(name) {
    if (!views[name] || name === currentView) return;
    render(name);
    history.pushState({ view: name }, "");
  }

  window.addEventListener("popstate", (e) => {
    const name = e.state?.view;
    if (name && views[name] && name !== currentView) {
      render(name);
    }
  });

  Object.entries(tabs).forEach(([name, btn]) => {
    btn?.addEventListener("click", () => switchTo(tabTargets[name] || name));
  });

  return { switchTo };
}
