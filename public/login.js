// MIT. Owner sign-in. A same-origin JSON post; no third-party script.

const form = document.querySelector("#login-form");
const status = document.querySelector("#login-status");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = form.querySelector("button");
  button.disabled = true;
  status.textContent = "Checking…";
  try {
    const response = await fetch("/api/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passphrase: new FormData(form).get("passphrase") }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      status.textContent = payload?.error?.message ?? "That did not work. Try again.";
      button.disabled = false;
      form.querySelector('[name="passphrase"]').select();
      return;
    }
    location.href = "/";
  } catch {
    status.textContent = "Could not reach the studio. Check the connection.";
    button.disabled = false;
  }
});
