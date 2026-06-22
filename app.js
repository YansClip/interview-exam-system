let exam = null;
let flatItems = [];

const categoryList = document.querySelector("#categoryList");
const questionMap = document.querySelector("#questionMap");
const sidebarFooter = document.querySelector("#sidebarFooter");
const problemContent = document.querySelector("#problemContent");
const prevButton = document.querySelector("#prevButton");
const nextButton = document.querySelector("#nextButton");
const topSubmitButton = document.querySelector("#topSubmitButton");
const bottomSubmitButton = document.querySelector("#bottomSubmitButton");
const logoutButton = document.querySelector("#logoutButton");
const loginStatus = document.querySelector("#loginStatus");
const countdownTimer = document.querySelector("#countdownTimer");
const examTitleElement = document.querySelector("#examTitle");

const draftKey = "exam_system_draft";
const submittedFlagKey = "exam_system_submitted";
const allowedCodeLanguages = ["Python", "C++", "Java"];
let examDurationSeconds = 40 * 60;
let currentIndex = 0;
let activeProblemId = "";
let codeDebugOpen = false;
let codeFullscreenOpen = false;
let examSession = null;
let candidateNameDraft = "";
let countdownInterval = null;
let examLeaveConfirmed = false;
let leaveDialogOpen = false;
let ignorePopstate = false;
let inputLocked = false;
let examSubmitting = false;
let examAutoSubmitted = false;
let answers = {
  codeProblem: "",
  codeLanguage: "Python",
  codeAnswer: "",
  codeAnswers: {},
  codeTestInputs: {},
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function optionLabel(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function ui(key, params) {
  return window.I18n ? window.I18n.t(key, params) : key;
}

function showModal({ title, message, messageHtml = "", confirmText, cancelText = "", type = "message", primary = "confirm", dialogClass = "" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const primaryIsCancel = type === "confirm" && primary === "cancel";
    const confirmClass = primaryIsCancel ? "secondary" : "";
    const cancelClass = primaryIsCancel ? "" : "secondary";
    const resolvedConfirm = confirmText || ui("common.know");
    const resolvedCancel = cancelText || ui("common.cancel");
    const dialogClasses = ["modal-dialog", dialogClass].filter(Boolean).join(" ");
    overlay.innerHTML = `
      <div class="${dialogClasses}" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h2 id="modalTitle">${escapeHtml(title)}</h2>
        ${messageHtml || ""}
        ${!messageHtml && message ? `<p>${escapeHtml(message)}</p>` : ""}
        <div class="modal-actions">
          ${
            type === "confirm"
              ? `<button class="${cancelClass}" type="button" data-modal-cancel>${escapeHtml(resolvedCancel)}</button>`
              : ""
          }
          <button class="${confirmClass}" type="button" data-modal-confirm>${escapeHtml(resolvedConfirm)}</button>
        </div>
      </div>
    `;

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    overlay.querySelector("[data-modal-confirm]").addEventListener("click", () => close(true));
    overlay.querySelector("[data-modal-cancel]")?.addEventListener("click", () => close(false));
    overlay.addEventListener("click", (event) => {
      if (event.target === overlay && type === "confirm") close(false);
    });
    document.body.appendChild(overlay);
    const primarySelector = primaryIsCancel ? "[data-modal-cancel]" : "[data-modal-confirm]";
    overlay.querySelector(primarySelector)?.focus();
  });
}

function showMessage(title, message, confirmText) {
  return showModal({ title, message, confirmText: confirmText || ui("common.know") });
}

function showConfirm(title, message, confirmText, cancelText, primary = "confirm", options = {}) {
  return showModal({
    title,
    message,
    messageHtml: options.messageHtml || "",
    confirmText: confirmText || ui("common.confirm"),
    cancelText: cancelText || ui("common.cancel"),
    type: "confirm",
    primary,
    dialogClass: options.dialogClass || "",
  });
}

function allowExamLeave() {
  examLeaveConfirmed = true;
}

async function confirmLeavePage() {
  if (leaveDialogOpen) return false;
  leaveDialogOpen = true;
  const confirmed = await showConfirm(
    ui("exam.leaveTitle"),
    ui("exam.leaveMessage"),
    ui("exam.leaveConfirm"),
    ui("exam.leaveCancel"),
    "cancel"
  );
  leaveDialogOpen = false;
  return confirmed;
}

function bindLeaveProtection() {
  history.pushState({ examGuard: true }, "", window.location.href);

  window.addEventListener("beforeunload", (event) => {
    if (examLeaveConfirmed) return;
    event.preventDefault();
    event.returnValue = "";
  });

  window.addEventListener("popstate", () => {
    if (examLeaveConfirmed || ignorePopstate) return;

    ignorePopstate = true;
    history.go(1);

    void (async () => {
      const confirmed = await confirmLeavePage();
      ignorePopstate = false;
      if (!confirmed) return;
      allowExamLeave();
      history.go(-2);
    })();
  });

  document.addEventListener(
    "keydown",
    (event) => {
      if (examLeaveConfirmed) return;
      const isReloadKey =
        event.key === "F5" ||
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "r");
      if (!isReloadKey) return;
      event.preventDefault();
      void (async () => {
        const confirmed = await confirmLeavePage();
        if (!confirmed) return;
        allowExamLeave();
        window.location.reload();
      })();
    },
    true,
  );
}

function localizedSectionTitle(section) {
  return window.I18n?.sectionLabel(section.id, section.title) || section.title;
}

function localizedSectionDescription(section) {
  return window.I18n?.sectionDescription(section.id, section.description) || section.description;
}

function buildFlatItems() {
  if (!exam) return [];
  const items = [];
  exam.sections.forEach((section) => {
    section.questions.forEach((question) => {
      items.push({
        kind: "question",
        no: items.length + 1,
        sectionId: section.id,
        sectionTitle: localizedSectionTitle(section),
        sectionDescription: localizedSectionDescription(section),
        question,
      });
    });
  });

  items.push({
    kind: "code",
    no: items.length + 1,
    sectionId: "code",
    sectionTitle: ui("exam.codeSectionTitle"),
    sectionDescription: ui("exam.codeSectionDesc"),
    question: {
      id: "code",
      title: ui("exam.codeSectionTitle"),
      difficulty: "很难",
      score: exam?.codeMaxScore ?? 29,
    },
  });

  return items;
}

function getCurrentItem() {
  return flatItems[currentIndex];
}

function getValue(selector) {
  return document.querySelector(selector)?.value.trim() || "";
}

function ensureCodeAnswersBucket() {
  if (!answers.codeAnswers || typeof answers.codeAnswers !== "object") {
    answers.codeAnswers = {};
  }
}

function getCodeAnswerForProblem(problemId = activeProblemId) {
  ensureCodeAnswersBucket();
  const id = problemId || answers.codeProblem || activeProblemId;
  if (id && answers.codeAnswers[id] !== undefined) {
    return answers.codeAnswers[id];
  }
  if (answers.codeAnswer && id === (answers.codeProblem || activeProblemId)) {
    return answers.codeAnswer;
  }
  return "";
}

function setCodeAnswerForProblem(problemId, value) {
  ensureCodeAnswersBucket();
  const id = problemId || activeProblemId;
  if (!id) return;
  answers.codeAnswers[id] = value;
  if (id === activeProblemId) {
    answers.codeAnswer = value;
  }
}

async function loadExamPaper(job) {
  const response = await fetch(`/api/exams/active?job=${encodeURIComponent(job)}`, { credentials: "include" });
  const data = await response.json();
  if (!response.ok || !data.ok || !data.paper) {
    throw new Error(data.message || "无法加载试卷");
  }
  exam = data.paper;
  examDurationSeconds = (exam.durationMinutes || 40) * 60;
  flatItems = buildFlatItems();
  activeProblemId = exam.codeProblems?.[0]?.id || "";
  answers.codeProblem = activeProblemId;
}

async function fetchExamSession() {
  const response = await fetch("/api/exam/session", { credentials: "include" });
  const data = await response.json();
  if (!response.ok || !data.ok) {
    throw new Error(data.message || "登录已失效");
  }
  if (data.alreadySubmitted) {
    sessionStorage.setItem(submittedFlagKey, "1");
    window.location.href = "./success.html";
    return null;
  }
  return data.session;
}

function applyExamSession() {
  const nameInput = document.querySelector("#candidateName");
  if (nameInput && !nameInput.value.trim()) {
    nameInput.value = candidateNameDraft || examSession.username || "";
  }
  document.querySelector("#candidateContact").value = examSession.phone;
  document.querySelector("#candidateRole").value = window.I18n?.jobLabel(examSession.job) || examSession.job;
  const title = exam?.title || examSession.job;
  examTitleElement.textContent = title;
  document.title = title;
  loginStatus.textContent = ui("exam.recordingActive");
  const timeLimitEl = document.querySelector("#examTimeLimit");
  if (timeLimitEl && exam?.durationMinutes) {
    timeLimitEl.textContent =
      window.I18n?.getLang() === "en"
        ? `Time limit: ${exam.durationMinutes} min`
        : `答题时间：${exam.durationMinutes}min`;
  }
}

function saveDraft() {
  syncCodeAnswerFromEditor();
  const draft = {
    currentIndex,
    activeProblemId,
    candidateName: getValue("#candidateName"),
    answers: {
      ...answers,
      codeLanguage: answers.codeLanguage,
      codeAnswers: { ...answers.codeAnswers },
    },
  };
  localStorage.setItem(draftKey, JSON.stringify(draft));
}

function loadDraft() {
  const raw = localStorage.getItem(draftKey);
  if (!raw) return;

  try {
    const draft = JSON.parse(raw);
    candidateNameDraft = String(draft.candidateName || "").trim();
    answers = { ...answers, ...(draft.answers || {}) };
    ensureCodeAnswersBucket();
    if (!Object.keys(answers.codeAnswers).length && answers.codeAnswer) {
      const legacyProblemId = draft.activeProblemId || answers.codeProblem || activeProblemId;
      if (legacyProblemId) {
        answers.codeAnswers[legacyProblemId] = answers.codeAnswer;
      }
    }
    activeProblemId = draft.activeProblemId || answers.codeProblem || activeProblemId;
    answers.codeProblem = activeProblemId;
    currentIndex = Math.max(0, Math.min(flatItems.length - 1, Number(draft.currentIndex) || 0));
    if (!allowedCodeLanguages.includes(answers.codeLanguage)) answers.codeLanguage = "Python";
    if (!answers.codeTestInputs) answers.codeTestInputs = {};
  } catch (error) {
    localStorage.removeItem(draftKey);
  }
}

function sectionItems(sectionId) {
  return flatItems.filter((item) => item.sectionId === sectionId);
}

function isAnswered(item) {
  if (item.kind === "code") return Boolean(getCodeAnswerForProblem(activeProblemId).trim());
  const answer = answers[item.question.id];
  return Array.isArray(answer) ? answer.length > 0 : Boolean(answer);
}

function renderCategoryList() {
  const currentSectionId = getCurrentItem().sectionId;
  const categories = exam.sections.map((section) => ({
    id: section.id,
    title: localizedSectionTitle(section),
    total: sectionItems(section.id).length,
    answered: sectionItems(section.id).filter(isAnswered).length,
  }));

  categories.push({
    id: "code",
    title: ui("exam.codeCategory"),
    total: 1,
    answered: sectionItems("code").filter(isAnswered).length,
  });

  categoryList.innerHTML = categories
    .map(
      (category) => `
        <button class="category-item ${category.id === currentSectionId ? "active" : ""}" type="button" data-category="${category.id}">
          <span>${escapeHtml(category.title)}</span>
          <span class="category-count">${category.answered} / ${category.total}</span>
        </button>
      `
    )
    .join("");
}

function renderQuestionMap() {
  questionMap.innerHTML = flatItems
    .map(
      (item, index) => `
        <button
          class="map-button ${index === currentIndex ? "current" : ""} ${isAnswered(item) ? "answered" : ""}"
          type="button"
          data-index="${index}"
          title="${escapeHtml(ui("exam.questionTitle", { no: item.no, title: item.question.title }))}"
        >
          ${item.no}
        </button>
      `
    )
    .join("");

  sidebarFooter.textContent = ui("exam.progress", {
    current: currentIndex + 1,
    total: flatItems.length,
  });
}

function renderHeader(item) {
  return `
    <div class="problem-title-row">
      <div>
        <h2>
          ${item.no}. ${escapeHtml(item.question.title)}
          <span class="score-pill">${escapeHtml(ui("exam.score", { score: item.question.score }))}</span>
        </h2>
        <p class="problem-intro">${escapeHtml(item.sectionDescription)}</p>
      </div>
    </div>
  `;
}

function renderQuestionTable(question) {
  const table = question.table
    ? `<table class="data-table">${question.table
        .map((row, rowIndex) => {
          const cells = row
            .map((cell) => {
              const tag = rowIndex === 0 ? "th" : "td";
              return `<${tag}>${escapeHtml(cell)}</${tag}>`;
            })
            .join("");
          return `<tr>${cells}</tr>`;
        })
        .join("")}</table>`
    : "";
  return table;
}

function renderChoiceQuestion(item) {
  const question = item.question;
  const inputType = question.type === "single" ? "radio" : "checkbox";
  const storedAnswer = answers[question.id] || (question.type === "multiple" ? [] : "");
  const maxHint = question.maxChoices
    ? `<p class="prompt">${escapeHtml(ui("exam.maxChoices", { count: question.maxChoices }))}</p>`
    : "";

  return `
    ${renderHeader(item)}
    <div class="question-body">
      <p>${escapeHtml(question.title)}</p>
      ${question.prompt ? `<pre class="code-block">${escapeHtml(question.prompt)}</pre>` : ""}
      ${renderQuestionTable(question)}
      ${maxHint}
      <div class="options">
        ${question.options
          .map((option, optionIndex) => {
            const value = optionLabel(optionIndex);
            const checked = Array.isArray(storedAnswer) ? storedAnswer.includes(value) : storedAnswer === value;
            return `
              <label class="option">
                <input
                  type="${inputType}"
                  name="${question.id}"
                  value="${value}"
                  ${checked ? "checked" : ""}
                  ${question.maxChoices ? `data-max="${question.maxChoices}"` : ""}
                  data-answer-input
                />
                <span>${value}. ${escapeHtml(option)}</span>
              </label>
            `;
          })
          .join("")}
      </div>
    </div>
  `;
}

function renderTextQuestion(item) {
  const question = item.question;
  return `
    ${renderHeader(item)}
    <div class="question-body">
      ${question.prompt ? `<pre class="code-block">${escapeHtml(question.prompt)}</pre>` : ""}
      <label>
        ${escapeHtml(ui("exam.answer"))}
        <input
          name="${question.id}"
          type="text"
          value="${escapeHtml(answers[question.id] || "")}"
          placeholder="${escapeHtml(question.placeholder && question.placeholder !== "请输入答案" ? question.placeholder : ui("exam.answerPlaceholder"))}"
          data-answer-input
        />
      </label>
    </div>
  `;
}

function renderCodeProblem(problem) {
  return `
    <div class="problem-section">
      ${problem.body
        .map(([title, content]) => {
          const isSample = title.includes("样例");
          return `
            <h3>${escapeHtml(title)}</h3>
            ${isSample ? `<pre>${escapeHtml(content)}</pre>` : `<p>${escapeHtml(content).replaceAll("\n", "<br/>")}</p>`}
          `;
        })
        .join("")}
    </div>
  `;
}

function getCodeSampleInput(problem) {
  const entry = problem.body.find(([title]) => title.includes("输入样例"));
  return entry ? entry[1] : "";
}

function getCodeTestInput(problem) {
  if (answers.codeTestInputs && answers.codeTestInputs[problem.id] !== undefined) {
    return answers.codeTestInputs[problem.id];
  }
  return getCodeSampleInput(problem);
}

function renderCodeLanguageOptions(selectedLanguage) {
  return allowedCodeLanguages
    .map((language) => {
      const label = language === "Python" ? "Python (python3)" : language;
      return `<option value="${language}" ${language === selectedLanguage ? "selected" : ""}>${label}</option>`;
    })
    .join("");
}

function renderCodeQuestion(item) {
  const activeProblem = exam.codeProblems.find((problem) => problem.id === activeProblemId) || exam.codeProblems[0];
  const testInput = getCodeTestInput(activeProblem);
  const currentLanguage = answers.codeLanguage || "Python";

  return `
    <div class="code-workspace">
      <div class="code-panel code-panel--desc">
        ${renderHeader(item)}
        <div class="question-body">
          <div class="problem-tabs">
            ${exam.codeProblems
              .map(
                (problem) => `
                  <button class="tab-button ${problem.id === activeProblemId ? "active" : ""}" type="button" data-code-tab="${problem.id}">
                    ${escapeHtml(problem.title)}
                  </button>
                `
              )
              .join("")}
          </div>
          ${renderCodeProblem(activeProblem)}
        </div>
      </div>
      <div class="code-panel code-panel--editor${codeFullscreenOpen ? " is-fullscreen" : ""}">
        <div class="code-editor-toolbar">
          <select id="codeLanguageEditor" class="code-lang-select" aria-label="${escapeHtml(ui("exam.codeLang"))}">
            ${renderCodeLanguageOptions(currentLanguage)}
          </select>
          <div class="code-editor-tools">
            <button
              class="icon-tool-button ${codeDebugOpen ? "active" : ""}"
              type="button"
              data-code-debug
              aria-label="${escapeHtml(ui("exam.debug"))}"
              title="${escapeHtml(ui("exam.debug"))}"
            >
              <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
                <path
                  d="M5 7h14v11H5zM8 11l2.5 2.5L8 16M13 16h3"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.8"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </button>
            <button
              class="icon-tool-button icon-tool-button--run"
              type="button"
              data-code-run
              aria-label="${escapeHtml(ui("exam.run"))}"
              title="${escapeHtml(ui("exam.run"))}"
            >▶</button>
            <button
              class="icon-tool-button ${codeFullscreenOpen ? "active" : ""}"
              type="button"
              data-code-fullscreen
              aria-label="${escapeHtml(codeFullscreenOpen ? ui("exam.exitFullscreen") : ui("exam.fullscreen"))}"
              title="${escapeHtml(codeFullscreenOpen ? ui("exam.exitFullscreen") : ui("exam.fullscreen"))}"
            >⤢</button>
          </div>
        </div>
        <div class="code-editor-shell">
          <div id="codeEditorHost" class="code-editor-host" aria-label="代码编辑器"></div>
        </div>
        <div class="code-testcases-panel ${codeDebugOpen ? "is-expanded" : ""}" id="codeTestcasesPanel">
          <button class="code-testcases-bar" type="button" data-code-debug-toggle aria-expanded="${codeDebugOpen}">
            <span>${escapeHtml(ui("exam.testcases"))}</span>
            <span class="code-testcases-chevron" aria-hidden="true">${codeDebugOpen ? "▼" : "▲"}</span>
          </button>
          <div class="code-testcases-body-wrap">
            <label class="code-testcases-label">${escapeHtml(ui("exam.testInput"))}</label>
            <textarea id="codeTestInput" class="code-test-input" spellcheck="false">${escapeHtml(testInput || "")}</textarea>
            <label class="code-testcases-label">${escapeHtml(ui("exam.runOutput"))}</label>
            <pre id="codeRunOutput" class="code-run-output">${escapeHtml(ui("exam.runHint"))}</pre>
          </div>
        </div>
      </div>
    </div>
  `;
}

function getCodeAnswerValue() {
  return window.CodeEditor?.getValue?.() ?? getCodeAnswerForProblem(activeProblemId) ?? "";
}

function syncCodeAnswerFromEditor() {
  setCodeAnswerForProblem(activeProblemId, getCodeAnswerValue());
}

function syncCodeLanguageSelectors(language) {
  const editorSelect = document.querySelector("#codeLanguageEditor");
  if (editorSelect && editorSelect.value !== language) editorSelect.value = language;
}

function setCodeDebugOpen(open) {
  codeDebugOpen = open;
  const panel = document.querySelector("#codeTestcasesPanel");
  const debugButton = document.querySelector("[data-code-debug]");
  const toggleButton = document.querySelector("[data-code-debug-toggle]");
  const chevron = document.querySelector(".code-testcases-chevron");

  panel?.classList.toggle("is-expanded", open);
  debugButton?.classList.toggle("active", open);
  toggleButton?.setAttribute("aria-expanded", String(open));
  if (chevron) chevron.textContent = open ? "▼" : "▲";
}

function setCodeFullscreenOpen(open) {
  codeFullscreenOpen = open;
  const editorPanel = document.querySelector(".code-panel--editor");
  const fullscreenButton = document.querySelector("[data-code-fullscreen]");

  editorPanel?.classList.toggle("is-fullscreen", open);
  fullscreenButton?.classList.toggle("active", open);
  if (fullscreenButton) {
    fullscreenButton.setAttribute("aria-label", open ? ui("exam.exitFullscreen") : ui("exam.fullscreen"));
    fullscreenButton.setAttribute("title", open ? ui("exam.exitFullscreen") : ui("exam.fullscreen"));
  }
  document.body.classList.toggle("code-fullscreen-active", open);
  requestAnimationFrame(() => window.CodeEditor?.layout?.());
}

function saveCodeTestInput(value) {
  if (!answers.codeTestInputs) answers.codeTestInputs = {};
  answers.codeTestInputs[activeProblemId] = value;
  saveDraft();
}

function formatRunOutput(data) {
  const stdout = String(data?.stdout || "").replace(/\s+$/, "");
  const stderr = String(data?.stderr || "").replace(/\s+$/, "");
  const message = String(data?.message || "").trim();
  const lines = [];
  const exitCode = data?.exitCode;
  const durationText = data?.durationMs !== undefined ? ` · ${data.durationMs} ms` : "";

  if (exitCode !== undefined) {
    lines.push(exitCode === 0 ? `运行完成${durationText}` : `运行结束，退出码 ${exitCode}${durationText}`);
  }
  if (stdout) lines.push(`标准输出：\n${stdout}`);
  if (stderr) lines.push(`错误输出：\n${stderr}`);
  if (message) lines.push(`提示：${message}`);
  if (!stdout && !stderr && !message && exitCode === 0) lines.push("程序运行结束，无输出。");
  return lines.join("\n\n") || ui("exam.runFailed");
}

async function runCandidateCode() {
  const code = getCodeAnswerValue();
  const inputEl = document.querySelector("#codeTestInput");
  const outputEl = document.querySelector("#codeRunOutput");
  const runButtons = [...document.querySelectorAll("[data-code-run]")];

  if (!code.trim()) {
    await showMessage(ui("exam.cannotRun"), ui("exam.writeCodeFirst"));
    return;
  }

  syncCodeAnswerFromEditor();
  setCodeDebugOpen(true);
  runButtons.forEach((button) => {
    button.disabled = true;
  });
  if (outputEl) outputEl.textContent = ui("exam.running");

  try {
    const response = await fetch("/api/run-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        code,
        language: answers.codeLanguage || "Python",
        input: inputEl?.value || "",
      }),
    });
    const data = await response.json();
    if (outputEl) outputEl.textContent = formatRunOutput(data);
  } catch (error) {
    if (outputEl) outputEl.textContent = error.message || ui("exam.runFailed");
  } finally {
    runButtons.forEach((button) => {
      button.disabled = false;
    });
  }
}

async function initCodeEditor() {
  const host = document.querySelector("#codeEditorHost");
  const editorSelect = document.querySelector("#codeLanguageEditor");
  const debugButton = document.querySelector("[data-code-debug]");
  const debugToggleButton = document.querySelector("[data-code-debug-toggle]");
  const fullscreenButton = document.querySelector("[data-code-fullscreen]");
  const runButtons = document.querySelectorAll("[data-code-run]");
  const testInput = document.querySelector("#codeTestInput");

  if (!host) return;

  syncCodeLanguageSelectors(answers.codeLanguage || "Python");
  setCodeDebugOpen(codeDebugOpen);
  setCodeFullscreenOpen(codeFullscreenOpen);

  try {
    await window.CodeEditor.mount(host, {
      value: getCodeAnswerForProblem(activeProblemId),
      language: answers.codeLanguage || "Python",
      onChange: (value) => {
        setCodeAnswerForProblem(activeProblemId, value);
        saveDraft();
        refreshProgress();
      },
    });
  } catch (error) {
    host.innerHTML = `<div class="code-editor-fallback">${escapeHtml(ui("exam.editorLoadFailed"))}</div>`;
    return;
  }

  editorSelect?.addEventListener("change", () => {
    answers.codeLanguage = editorSelect.value;
    window.CodeEditor.setLanguage(editorSelect.value);
    syncCodeLanguageSelectors(editorSelect.value);
    saveDraft();
  });

  const toggleDebug = () => {
    setCodeDebugOpen(!codeDebugOpen);
    requestAnimationFrame(() => window.CodeEditor?.layout?.());
  };

  debugButton?.addEventListener("click", toggleDebug);
  debugToggleButton?.addEventListener("click", toggleDebug);

  runButtons.forEach((button) => {
    button.addEventListener("click", runCandidateCode);
  });

  testInput?.addEventListener("input", () => {
    saveCodeTestInput(testInput.value);
  });

  fullscreenButton?.addEventListener("click", () => {
    setCodeFullscreenOpen(!codeFullscreenOpen);
    window.CodeEditor?.focus?.();
  });
}

function renderCurrent() {
  const item = getCurrentItem();
  const mainContent = document.querySelector("#mainContent");
  const sectionStrip = document.querySelector("#sectionStrip");

  mainContent?.classList.toggle("content--code", item.kind === "code");
  if (sectionStrip) sectionStrip.hidden = item.kind === "code";

  if (item.kind === "code") {
    window.CodeEditor?.dispose?.();
    problemContent.innerHTML = renderCodeQuestion(item);
    initCodeEditor();
  } else {
    window.CodeEditor?.dispose?.();
    if (codeFullscreenOpen) setCodeFullscreenOpen(false);
    if (item.question.type === "single" || item.question.type === "multiple") {
      problemContent.innerHTML = renderChoiceQuestion(item);
    } else {
      problemContent.innerHTML = renderTextQuestion(item);
    }
  }

  prevButton.disabled = currentIndex === 0;
  nextButton.disabled = currentIndex === flatItems.length - 1;
  renderCategoryList();
  renderQuestionMap();
}

function refreshProgress() {
  renderCategoryList();
  renderQuestionMap();
}

function goToIndex(index) {
  if (getCurrentItem()?.kind === "code") {
    syncCodeAnswerFromEditor();
  }
  currentIndex = Math.max(0, Math.min(flatItems.length - 1, index));
  saveDraft();
  renderCurrent();
}

function updateAnswerFromInput(input) {
  const item = getCurrentItem();
  if (item.kind === "code") return;

  const question = item.question;
  if (question.type === "single" || question.type === "multiple") {
    if (question.type === "single") {
      answers[question.id] = document.querySelector(`input[name="${question.id}"]:checked`)?.value || "";
    } else {
      answers[question.id] = [...document.querySelectorAll(`input[name="${question.id}"]:checked`)].map(
        (item) => item.value
      );
    }
  } else {
    answers[question.id] = input.value.trim();
  }
  saveDraft();
  refreshProgress();
}

function bindEvents() {
  document.addEventListener("change", (event) => {
    const input = event.target;
    if (input.type === "checkbox" && input.dataset.max && input.checked) {
      const checked = [...document.querySelectorAll(`input[name="${input.name}"]:checked`)];
      const max = Number(input.dataset.max);
      if (checked.length > max) {
        input.checked = false;
        showMessage(ui("exam.tooManyChoices"), ui("exam.maxChoices", { count: max }));
      }
    }

    if (input.matches("[data-answer-input]")) {
      updateAnswerFromInput(input);
    }

    if (input.id === "codeLanguageEditor") {
      answers.codeLanguage = input.value;
      saveDraft();
    }
  });

  document.addEventListener("input", (event) => {
    const input = event.target;
    if (input.id === "candidateName") {
      saveDraft();
      return;
    }
    if (input.matches("[data-answer-input]")) {
      updateAnswerFromInput(input);
    }
  });

  document.addEventListener("click", (event) => {
    const mapButton = event.target.closest("[data-index]");
    if (mapButton) {
      goToIndex(Number(mapButton.dataset.index));
      return;
    }

    const categoryButton = event.target.closest("[data-category]");
    if (categoryButton) {
      const targetIndex = flatItems.findIndex((item) => item.sectionId === categoryButton.dataset.category);
      if (targetIndex >= 0) goToIndex(targetIndex);
      return;
    }

    const codeTab = event.target.closest("[data-code-tab]");
    if (codeTab) {
      syncCodeAnswerFromEditor();
      activeProblemId = codeTab.dataset.codeTab;
      answers.codeProblem = activeProblemId;
      saveDraft();
      renderCurrent();
    }
  });

  prevButton.addEventListener("click", () => goToIndex(currentIndex - 1));
  nextButton.addEventListener("click", () => goToIndex(currentIndex + 1));
  topSubmitButton.addEventListener("click", submitExam);
  bottomSubmitButton.addEventListener("click", submitExam);
  logoutButton.addEventListener("click", async () => {
    const confirmed = await confirmLeavePage();
    if (!confirmed) return;
    allowExamLeave();
    try {
      await fetch("/api/exam/logout", { method: "POST", credentials: "include" });
    } catch (error) {
      // ignore network errors during logout
    }
    localStorage.removeItem(draftKey);
    window.location.href = "./login.html";
  });
}

function collectAnswers() {
  syncCodeAnswerFromEditor();
  const submissionAnswers = {};

  exam.sections.forEach((section) => {
    section.questions.forEach((question) => {
      submissionAnswers[question.id] = answers[question.id] || (question.type === "multiple" ? [] : "");
    });
  });

  submissionAnswers.codeProblem = answers.codeProblem || activeProblemId;
  submissionAnswers.codeLanguage = document.querySelector("#codeLanguageEditor")?.value || answers.codeLanguage || "Python";
  submissionAnswers.codeAnswer = getCodeAnswerForProblem(submissionAnswers.codeProblem) || "";
  return submissionAnswers;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "-";
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${minutes} 分 ${restSeconds} 秒`;
}

function formatCountdown(seconds) {
  const safeSeconds = Math.max(0, seconds);
  const minutes = String(Math.floor(safeSeconds / 60)).padStart(2, "0");
  const restSeconds = String(safeSeconds % 60).padStart(2, "0");
  return `${minutes}:${restSeconds}`;
}

function getRemainingSeconds() {
  const startedAt = new Date(examSession?.startedAt || examSession?.loginAt).getTime();
  if (!startedAt) return examDurationSeconds;
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  const total = examSession?.durationMinutes ? examSession.durationMinutes * 60 : examDurationSeconds;
  return Math.max(0, total - elapsedSeconds);
}

async function updateCountdown() {
  const remainingSeconds = getRemainingSeconds();
  countdownTimer.textContent = ui("exam.remaining", { time: formatCountdown(remainingSeconds) });
  countdownTimer.classList.toggle("warning", remainingSeconds <= 10 * 60 && remainingSeconds > 5 * 60);
  countdownTimer.classList.toggle("danger", remainingSeconds <= 5 * 60);

  if (remainingSeconds === 0 && !examAutoSubmitted && !examSubmitting) {
    examAutoSubmitted = true;
    clearInterval(countdownInterval);
    await showMessage(ui("exam.timeUpTitle"), ui("exam.timeUpMessage"));
    await submitExam({ skipConfirm: true, allowIncomplete: true });
  }
}

function startCountdown() {
  updateCountdown();
  countdownInterval = setInterval(updateCountdown, 1000);
}

function validateSubmission(submissionAnswers) {
  const missing = [];
  if (!getValue("#candidateName")) missing.push("姓名");
  if (!getValue("#candidateContact")) missing.push("联系方式");

  flatItems.forEach((item) => {
    if (item.kind === "code") {
      if (!(submissionAnswers.codeAnswer || "").trim()) missing.push(`第 ${item.no} 题`);
      return;
    }

    const answer = submissionAnswers[item.question.id];
    if (Array.isArray(answer) ? answer.length === 0 : !answer) {
      missing.push(`第 ${item.no} 题`);
    }
  });

  return missing;
}

function formatSubmitSummaryValue(item, submissionAnswers) {
  if (item.kind === "code") {
    const code = String(submissionAnswers.codeAnswer || "").trim();
    return code ? ui("exam.submitSummaryAnswered") : ui("exam.submitSummaryUnanswered");
  }

  const answer = submissionAnswers[item.question.id];
  if (Array.isArray(answer)) {
    return answer.length ? answer.join("、") : ui("exam.submitSummaryUnanswered");
  }
  return answer ? String(answer) : ui("exam.submitSummaryUnanswered");
}

function buildSubmitSummaryHtml(submissionAnswers) {
  const rows = flatItems
    .map((item) => {
      const value = formatSubmitSummaryValue(item, submissionAnswers);
      return `<div class="submit-summary-row"><span class="submit-summary-no">${item.no}</span><span class="submit-summary-sep">：</span><span class="submit-summary-value">${escapeHtml(value)}</span></div>`;
    })
    .join("");

  return `
    <p class="submit-summary-hint">${escapeHtml(ui("exam.submitSummaryHint"))}</p>
    <div class="submit-summary">${rows}</div>
  `;
}

async function submitExam(options = {}) {
  if (examSubmitting) return;

  if (!options.skipConfirm) {
    const previewAnswers = collectAnswers();
    const confirmed = await showConfirm(
      ui("exam.submitTitle"),
      "",
      ui("exam.submitConfirm"),
      ui("exam.submitCancel"),
      "cancel",
      {
        messageHtml: buildSubmitSummaryHtml(previewAnswers),
        dialogClass: "modal-dialog--summary",
      }
    );
    if (!confirmed) return;
  }

  const submissionAnswers = collectAnswers();
  const missing = validateSubmission(submissionAnswers);
  if (missing.length > 0 && !options.allowIncomplete) {
    const stillSubmit = await showConfirm(
      ui("exam.incompleteTitle"),
      `${missing.slice(0, 12).join("\n")}${missing.length > 12 ? "\n..." : ""}`,
      ui("exam.incompleteConfirm"),
      ui("common.know")
    );
    if (!stillSubmit) return;
  }

  const submissionPayload = {
    examId: exam?.id || examSession?.examId || null,
    examTitle: exam?.title || examSession?.job || "技术测验",
    source: exam?.source || "",
    candidateName: getValue("#candidateName"),
    answers: submissionAnswers,
  };

  examSubmitting = true;
  topSubmitButton.disabled = true;
  bottomSubmitButton.disabled = true;
  topSubmitButton.textContent = ui("exam.submitting");
  bottomSubmitButton.textContent = ui("exam.submitting");

  try {
    await window.AntiCheat?.flushReport?.(false);
    const response = await fetch("/api/submissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(submissionPayload),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "提交失败");
    }

    localStorage.removeItem(draftKey);
    sessionStorage.setItem(submittedFlagKey, "1");
    window.AntiCheat?.stop?.();
    allowExamLeave();
    window.location.href = "./success.html";
  } catch (error) {
    examSubmitting = false;
    examAutoSubmitted = false;
    await showMessage(ui("exam.submitFailed"), error.message);
    topSubmitButton.disabled = false;
    bottomSubmitButton.disabled = false;
    topSubmitButton.textContent = ui("exam.submit");
    bottomSubmitButton.textContent = ui("exam.submit");
  }
}

async function bootstrapExam() {
  if (window.location.protocol === "file:") {
    window.location.href = "./login.html";
    return;
  }

  try {
    examSession = await fetchExamSession();
    if (!examSession) return;
    await loadExamPaper(examSession.job);
  } catch (error) {
    window.location.href = "./login.html";
    return;
  }

  bindEvents();
  bindLeaveProtection();
  loadDraft();
  applyExamSession();
  startCountdown();
  let forceSubmitAfterWarn = false;
  let antiCheatWarnQueue = Promise.resolve();
  window.AntiCheat?.start?.({
    sessionKey: examSession?.loginAt || "",
    config: examSession?.antiCheat || {},
    onWarn: (modalMessage) => {
      antiCheatWarnQueue = antiCheatWarnQueue
        .then(() => showMessage(ui("exam.anticheatTitle"), modalMessage, ui("common.know")))
        .then(() => {
          window.AntiCheat?.hideBanner?.();
          if (!forceSubmitAfterWarn) return;
          forceSubmitAfterWarn = false;
          return submitExam({ skipConfirm: true, allowIncomplete: true, reason: "anticheat" });
        })
        .catch(() => {});
    },
    onForceSubmit: () => {
      forceSubmitAfterWarn = true;
    },
    onLockInput: () => {
      inputLocked = true;
      document.body.classList.add("exam-input-locked");
      window.CodeEditor?.setReadOnly?.(true);
      topSubmitButton.disabled = true;
      bottomSubmitButton.disabled = true;
      prevButton.disabled = true;
      nextButton.disabled = true;
    },
    onUnlockInput: () => {
      inputLocked = false;
      document.body.classList.remove("exam-input-locked");
      window.CodeEditor?.setReadOnly?.(false);
      topSubmitButton.disabled = false;
      bottomSubmitButton.disabled = false;
      prevButton.disabled = currentIndex <= 0;
      nextButton.disabled = currentIndex >= flatItems.length - 1;
    },
  });
  window.CodeEditor?.loadMonaco?.().catch(() => {});
  renderCurrent();
}

bootstrapExam();

function refreshExamUiLabels() {
  flatItems.forEach((item) => {
    if (item.kind === "code") {
      item.sectionTitle = ui("exam.codeSectionTitle");
      item.sectionDescription = ui("exam.codeSectionDesc");
      item.question.title = ui("exam.codeSectionTitle");
      return;
    }
    const section = exam?.sections?.find((entry) => entry.id === item.sectionId);
    if (!section) return;
    item.sectionTitle = localizedSectionTitle(section);
    item.sectionDescription = localizedSectionDescription(section);
  });
  if (examSession) applyExamSession();
  window.I18n?.applyDom();
  if (flatItems.length) {
    renderCurrent();
    updateCountdown();
  }
}

window.addEventListener("site-lang-change", refreshExamUiLabels);
