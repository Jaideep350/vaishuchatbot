const tabs = document.querySelectorAll(".tab");
const submit = document.getElementById("authSubmit");
const form = document.getElementById("authForm");
const errorEl = document.getElementById("authError");
let mode = "login";

tabs.forEach((t) => {
  t.addEventListener("click", () => {
    tabs.forEach((x) => x.classList.remove("active"));
    t.classList.add("active");
    mode = t.dataset.tab;
    submit.textContent = mode === "login" ? "Sign in" : "Create account";
    errorEl.textContent = "";
  });
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.textContent = "";
  const fd = new FormData(form);
  const body = JSON.stringify({
    email: fd.get("email"),
    password: fd.get("password"),
  });
  const url = mode === "login" ? "/api/login" : "/api/signup";
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { errorEl.textContent = j.error || "Failed"; return; }
  window.location.href = "/";
});
