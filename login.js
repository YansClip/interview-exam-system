const loginForm = document.querySelector("#loginForm");
const loginMessage = document.querySelector("#loginMessage");
const adminEntryButton = document.querySelector("#adminEntryButton");
const loginPhoneInput = document.querySelector("#loginPhone");
const loginRoleSelect = document.querySelector("#loginRole");
const loginRoleLabel = document.querySelector("#loginRoleLabel");
const loginRoleSelectWrapper = loginRoleSelect?.closest(".auth-select");

const DEFAULT_TEST_JOB = "大模型工程师";
let wasAdminTestPhone = false;

function setLoginMessage(message, type = "error") {
  loginMessage.textContent = message;
  loginMessage.dataset.type = type;
}

function showAdminPasswordModal() {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h2 id="modalTitle">${window.I18n?.t("login.adminPasswordTitle") || "请输入后台密码"}</h2>
        <label>
          ${window.I18n?.t("common.password") || "密码"}
          <input id="adminPasswordInput" type="password" autocomplete="current-password" />
        </label>
        <p id="adminPasswordMessage" class="form-message"></p>
        <div class="modal-actions">
          <button type="button" data-modal-confirm>${window.I18n?.t("common.confirm") || "确认"}</button>
          <button class="secondary" type="button" data-modal-cancel>${window.I18n?.t("common.cancel") || "取消"}</button>
        </div>
      </div>
    `;

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const passwordInput = overlay.querySelector("#adminPasswordInput");
    const passwordMessage = overlay.querySelector("#adminPasswordMessage");
    const submit = async () => {
      passwordMessage.textContent = "";
      try {
        const response = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ password: passwordInput.value }),
        });
        const data = await response.json();
        if (!response.ok || !data.ok) {
          passwordMessage.textContent = data.message || window.I18n?.t("login.passwordWrong") || "密码错误";
          passwordInput.focus();
          passwordInput.select();
          return;
        }
        close(true);
      } catch (error) {
        passwordMessage.textContent = window.I18n?.t("login.backendError") || "无法连接后端服务";
      }
    };

    overlay.querySelector("[data-modal-confirm]").addEventListener("click", submit);
    overlay.querySelector("[data-modal-cancel]").addEventListener("click", () => close(false));
    passwordInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") submit();
      if (event.key === "Escape") close(false);
    });
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) close(false);
    });

    document.body.appendChild(overlay);
    passwordInput.focus();
  });
}

adminEntryButton.addEventListener("click", async () => {
  const passed = await showAdminPasswordModal();
  if (passed) window.location.href = "./admin.html";
});

function isAdminTestPhone(phone) {
  return String(phone || "").trim() === "123";
}

function syncTestPhoneRoleField() {
  const testMode = isAdminTestPhone(loginPhoneInput?.value);
  if (loginRoleLabel) {
    loginRoleLabel.hidden = false;
  }
  if (loginRoleSelectWrapper) {
    loginRoleSelectWrapper.hidden = false;
  }
  if (loginRoleSelect) {
    loginRoleSelect.required = true;
    loginRoleSelect.disabled = false;
    if (testMode && !wasAdminTestPhone) {
      loginRoleSelect.value = DEFAULT_TEST_JOB;
    }
  }
  wasAdminTestPhone = testMode;
}

function getLoginJob() {
  return loginRoleSelect?.value || DEFAULT_TEST_JOB;
}

loginPhoneInput?.addEventListener("input", syncTestPhoneRoleField);
loginPhoneInput?.addEventListener("change", syncTestPhoneRoleField);
syncTestPhoneRoleField();

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (window.location.protocol === "file:") {
    setLoginMessage(window.I18n?.t("login.fileMode") || "当前是文件模式，无法连接后端。请访问：http://127.0.0.1:8787/login.html");
    return;
  }

  setLoginMessage(window.I18n?.t("login.checking") || "正在校验...", "info");

  const payload = {
    username: document.querySelector("#loginName").value.trim(),
    phone: loginPhoneInput.value.trim(),
    job: getLoginJob(),
  };

  try {
    const response = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    });
    const data = await response.json();

    if (!response.ok || !data.ok) {
      setLoginMessage(data.message || window.I18n?.t("login.failed") || "登录失败，请联系管理员。");
      return;
    }

    localStorage.removeItem("exam_system_session");
    localStorage.removeItem("exam_system_latest_submission");
    localStorage.removeItem("exam_system_draft");
    Object.keys(sessionStorage).forEach((key) => {
      if (key === "exam_system_integrity_cache" || key.startsWith("exam_system_integrity_cache:")) {
        sessionStorage.removeItem(key);
      }
    });
    window.location.href = "./index.html";
  } catch (error) {
    setLoginMessage(window.I18n?.t("login.backendHint") || "无法连接后端服务，请确认已通过 npm start 启动项目。");
  }
});
