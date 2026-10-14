import { createNav } from "./nav.js";
import { createDrawer } from "./drawer.js";
import { initHome } from "./views/home.js";
import { initGuide } from "./views/guide.js";
import { initCheck } from "./views/check.js";
import { initResult } from "./views/result.js";
import { initHistory } from "./views/history.js";
import { initRegister } from "./views/register.js";
import { initReference } from "./views/reference.js";
import { initTeam } from "./views/team.js";
import { initTestset } from "./views/testset.js";
import { initCompare } from "./views/compare.js";
import { initFaq } from "./views/faq.js";
import { initSignup } from "./views/signup.js";
import { initProfile } from "./views/profile.js";

const onBackHome = () => nav.switchTo("home");
const onSignup = () => nav.switchTo("signup");

const history = initHistory({ onBack: onBackHome, onSignup });
const compare = initCompare({ onBack: onBackHome, onSignup });
const register = initRegister({ onBack: onBackHome, onSignup });
const profile = initProfile({ onBack: onBackHome, onSignup });
const signup = initSignup({ onBack: onBackHome, onDone: onBackHome });
const drawer = createDrawer();

const nav = createNav(
  ["home", "guide", "register", "signup", "profile", "check", "result", "history", "reference", "team", "testset", "compare", "faq"],
  {
    onActivate(name) {
      if (name === "history") history.load();
      if (name === "compare") compare.load();
      if (name === "register") register.load();
      if (name === "profile") profile.load();
      if (name === "signup") signup.reset();
      if (name === "check") check.syncSession();
      drawer.close();
    },
    tabTargets: { check: "guide" }, // กดปุ่ม "การทดสอบ" ในเมนูให้ไปหน้าคู่มือการใช้งานก่อนเสมอ
  }
);

const result = initResult({ onAgain: () => nav.switchTo("check"), onHome: onBackHome });
const check = initCheck({
  onAnalyzed: (meta) => { result.show(meta); nav.switchTo("result"); },
  onBack: onBackHome,
  onSignup,
});

initHome({
  onStart: () => nav.switchTo("guide"),
  onRegister: () => nav.switchTo("signup"),
  onReference: () => nav.switchTo("reference"),
  onTeam: () => nav.switchTo("team"),
  onTestset: () => nav.switchTo("testset"),
  onFaq: () => nav.switchTo("faq"),
});
initGuide({ onStart: () => nav.switchTo("check"), onBack: onBackHome });
initReference({ onBack: onBackHome });
initTeam({ onBack: onBackHome });
initTestset({ onBack: onBackHome });
initFaq({ onBack: onBackHome });

document.getElementById("topbar-home-btn").addEventListener("click", onBackHome);

nav.switchTo("home");
