const tokenField = document.getElementById("token");
const copyButton = document.getElementById("copy");
const clearButton = document.getElementById("clear");
const status = document.getElementById("status");

function clearToken() {
  tokenField.value = "";
  copyButton.disabled = true;
  clearButton.disabled = true;
}

copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(tokenField.value);
    status.textContent = "Copied. Paste the ID token into your Postman request.";
  } catch {
    tokenField.focus();
    tokenField.select();
    status.textContent = "Clipboard access unavailable. Press Ctrl+C to copy the selected token.";
  }
});

clearButton.addEventListener("click", () => {
  clearToken();
  status.textContent = "Token cleared from this page. Your clipboard is unchanged.";
});
window.addEventListener("pagehide", clearToken);
window.addEventListener("pageshow", (event) => {
  if (event.persisted) clearToken();
});

async function initializeGoogle() {
  try {
    const response = await fetch("/config", { cache: "no-store" });
    if (!response.ok) throw new Error("Configuration unavailable");
    const { clientId } = await response.json();
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      google.accounts.id.initialize({
        client_id: clientId,
        ux_mode: "popup",
        auto_select: false,
        callback: (response) => {
          clearToken();
          if (typeof response.credential !== "string" || !response.credential) {
            status.textContent = "Google did not return an ID token. Please try again.";
            return;
          }
          tokenField.value = response.credential;
          copyButton.disabled = false;
          clearButton.disabled = false;
          status.textContent = "ID token received. Copy it for Postman testing.";
        },
      });
      google.accounts.id.renderButton(document.getElementById("google-button"), {
        theme: "outline", size: "large", text: "signin_with",
      });
      status.textContent = "Ready. Sign in with Google.";
    };
    script.onerror = () => {
      status.textContent = "Google Sign-In could not load. Check your internet connection.";
    };
    document.head.appendChild(script);
  } catch {
    status.textContent = "Cannot load Google configuration. Restart the local test server.";
  }
}

initializeGoogle();
