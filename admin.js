const candidateForm = document.querySelector("#candidateForm");
const candidatePhoneInput = document.querySelector("#candidatePhone");
const candidateTable = document.querySelector("#candidateTable");
const candidateApplyMonth = document.querySelector("#candidateApplyMonth");
const candidateApplyDay = document.querySelector("#candidateApplyDay");
const candidateApplyHour = document.querySelector("#candidateApplyHour");
const adminMessage = document.querySelector("#adminMessage");
const techAdminMessage = document.querySelector("#techAdminMessage");
const refreshButton = document.querySelector("#refreshButton");
const submissionTable = document.querySelector("#submissionTable");
const submissionDetail = document.querySelector("#submissionDetail");
const submissionDetailOverlay = document.querySelector("#submissionDetailOverlay");
const refreshSubmissionsButton = document.querySelector("#refreshSubmissionsButton");
const examMgmtSection = document.querySelector("#examMgmtSection");
const adminLogoutButton = document.querySelector("#adminLogoutButton");
const adminSubtitle = document.querySelector("#adminSubtitle");
const hrPanel = document.querySelector("#hrPanel");
const techPanel = document.querySelector("#techPanel");
const examImportForm = document.querySelector("#examImportForm");
const examImportPreview = document.querySelector("#examImportPreview");
const examSummaryTable = document.querySelector("#examSummaryTable");
const publishExamButton = document.querySelector("#publishExamButton");
const stemEditJob = document.querySelector("#stemEditJob");
const loadStemPaperButton = document.querySelector("#loadStemPaperButton");
const stemEditorLayout = document.querySelector("#stemEditorLayout");
const stemQuestionList = document.querySelector("#stemQuestionList");
const stemEditForm = document.querySelector("#stemEditForm");
const stemEditQuestionId = document.querySelector("#stemEditQuestionId");
const stemEditTitle = document.querySelector("#stemEditTitle");
const stemPromptField = document.querySelector("#stemPromptField");
const stemEditPrompt = document.querySelector("#stemEditPrompt");
const stemOptionsField = document.querySelector("#stemOptionsField");
const stemEditOptions = document.querySelector("#stemEditOptions");
const stemBodyField = document.querySelector("#stemBodyField");
const stemEditBody = document.querySelector("#stemEditBody");

let activeSubmissionId = "";
let activeSubmission = null;
let activeImportDraftId = null;
let adminRole = "hr";
let activeStemPaper = null;
let activeStemExamId = "";
let activeStemQuestions = [];
let activeStemQuestion = null;

function renderIntegritySection(submission) {
  const integrity = submission.integrity;
  if (!integrity) {
    return `<div class="admin-note">${escapeHtml(ui("admin.noIntegrity"))}</div>`;
  }

  const counts = integrity.counts || {};
  const events = (integrity.events || []).slice(-12);
  const violationCount = integrity.violationCount ?? 0;
  const hiddenCount = counts.visibility_hidden ?? 0;
  const blurCount = counts.window_blur ?? 0;
  const pasteCount = counts.paste_blocked ?? 0;
  const forcedSubmit = Boolean(integrity.forcedSubmit);

  const eventRows = events
    .map(
      (event) => `
        <tr>
          <td>${formatDate(event.at)}</td>
          <td>${escapeHtml(formatIntegrityEvent(event.type))}</td>
          <td>${escapeHtml(formatIntegrityDetail(event.type, event.detail))}</td>
        </tr>
      `
    )
    .join("");

  return `
    <section class="integrity-panel">
      <h4 class="submission-section-title">${escapeHtml(ui("admin.integrityTitle"))}</h4>
      <div class="integrity-summary">
        <span class="integrity-stat integrity-stat--total">${escapeHtml(ui("admin.integrityStat.violations"))}<strong>${violationCount}</strong>${escapeHtml(ui("admin.integrityStat.times"))}</span>
        <span class="integrity-stat integrity-stat--tab">${escapeHtml(ui("admin.integrityStat.tab"))}<strong>${hiddenCount}</strong>${escapeHtml(ui("admin.integrityStat.times"))}</span>
        <span class="integrity-stat integrity-stat--blur">${escapeHtml(ui("admin.integrityStat.blur"))}<strong>${blurCount}</strong>${escapeHtml(ui("admin.integrityStat.times"))}</span>
        <span class="integrity-stat integrity-stat--paste">${escapeHtml(ui("admin.integrityStat.paste"))}<strong>${pasteCount}</strong>${escapeHtml(ui("admin.integrityStat.times"))}</span>
        <span class="integrity-stat integrity-stat--forced ${forcedSubmit ? "is-yes" : "is-no"}">${escapeHtml(ui("admin.integrityStat.forced"))}<strong>${escapeHtml(forcedSubmit ? ui("common.yes") : ui("common.no"))}</strong></span>
      </div>
      ${
        eventRows
          ? `<table class="admin-table">
              <thead>
                <tr>
                  <th>${escapeHtml(ui("admin.col.time"))}</th>
                  <th>${escapeHtml(ui("admin.col.event"))}</th>
                  <th>${escapeHtml(ui("admin.col.detail"))}</th>
                </tr>
              </thead>
              <tbody>${eventRows}</tbody>
            </table>`
          : ""
      }
    </section>
  `;
}

function formatIntegrityEvent(type) {
  const key = `admin.integrity.event.${type}`;
  const translated = ui(key);
  return translated !== key ? translated : ui("admin.integrity.event.unknown");
}

function formatIntegrityDetail(type, detail) {
  const detailKey = detail ? `admin.integrity.detail.${detail}` : "";
  if (detailKey) {
    const translated = ui(detailKey);
    if (translated !== detailKey) return translated;
  }
  const typeKey = `admin.integrity.detailByType.${type}`;
  const typeTranslated = ui(typeKey);
  if (typeTranslated !== typeKey) return typeTranslated;
  return detail ? String(detail) : ui("admin.integrity.detail.unknown");
}

function configureAdminNavigation(role) {
  adminRole = role;

  if (role === "tech") {
    hrPanel?.classList.add("is-active");
    techPanel?.classList.add("is-active");
    if (adminSubtitle) adminSubtitle.textContent = ui("admin.subtitleTech");
    return;
  }

  hrPanel?.classList.add("is-active");
  techPanel?.classList.remove("is-active");
  if (adminSubtitle) adminSubtitle.textContent = ui("admin.subtitleHr");
}

function setAdminMessage(message, type = "error") {
  if (adminMessage) {
    adminMessage.textContent = message;
    adminMessage.dataset.type = type;
  }
}

function setTechMessage(message, type = "error") {
  if (!techAdminMessage) return;
  techAdminMessage.textContent = message;
  techAdminMessage.dataset.type = type;
}

function normalizeCandidatePhone(value) {
  return String(value || "").trim().replace(/\D/g, "");
}

function isValidCandidatePhone(value) {
  return /^1[3-9]\d{9}$/.test(normalizeCandidatePhone(value));
}

function ui(key, params) {
  return window.I18n ? window.I18n.t(key, params) : key;
}

function syncCandidatePhoneInput() {
  if (!candidatePhoneInput) return;
  const normalized = normalizeCandidatePhone(candidatePhoneInput.value).slice(0, 11);
  if (candidatePhoneInput.value !== normalized) {
    candidatePhoneInput.value = normalized;
  }
  candidatePhoneInput.setCustomValidity(
    normalized && !isValidCandidatePhone(normalized) ? ui("admin.invalidPhone") : ""
  );
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function showModal({ title, message, confirmText, cancelText = "", type = "message" }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const resolvedConfirm = confirmText || ui("common.confirm");
    const resolvedCancel = cancelText || ui("common.cancel");
    overlay.innerHTML = `
      <div class="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
        <h2 id="modalTitle">${escapeHtml(title)}</h2>
        <p>${escapeHtml(message)}</p>
        <div class="modal-actions">
          ${type === "confirm" ? `<button class="secondary" type="button" data-modal-cancel>${escapeHtml(resolvedCancel)}</button>` : ""}
          <button type="button" data-modal-confirm>${escapeHtml(resolvedConfirm)}</button>
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
    overlay.querySelector("[data-modal-confirm]").focus();
  });
}

function showConfirm(title, message, confirmText, cancelText) {
  return showModal({
    title,
    message,
    confirmText: confirmText || ui("common.confirm"),
    cancelText: cancelText || ui("common.cancel"),
    type: "confirm",
  });
}

function formatDate(value) {
  if (!value) return "-";
  const locale = window.I18n?.getLang() === "en" ? "en-US" : "zh-CN";
  return new Date(value).toLocaleString(locale, { hour12: false });
}

function formatApplyDateTime(value) {
  if (!value) return "-";
  const mdh = /^(\d{2})-(\d{2})-(\d{2})$/.exec(value);
  if (mdh) {
    if (window.I18n?.getLang() === "en") {
      return ui("admin.applyTimeFmt", {
        month: Number(mdh[1]),
        day: Number(mdh[2]),
        hour: Number(mdh[3]),
      });
    }
    return `${Number(mdh[1])}月${Number(mdh[2])}日 ${Number(mdh[3])}时`;
  }
  const legacy = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (legacy) {
    return `${Number(legacy[2])}月${Number(legacy[3])}日`;
  }
  return value;
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function fillSelectOptions(select, values) {
  if (!select) return;
  select.innerHTML = values
    .map((item) => `<option value="${pad2(item)}">${Number(item)}</option>`)
    .join("");
}

function initApplyDatePicker() {
  fillSelectOptions(
    candidateApplyMonth,
    Array.from({ length: 12 }, (_, index) => index + 1),
  );
  fillSelectOptions(
    candidateApplyDay,
    Array.from({ length: 31 }, (_, index) => index + 1),
  );
  fillSelectOptions(
    candidateApplyHour,
    Array.from({ length: 24 }, (_, index) => index),
  );
  resetApplyDateDefault();
}

function getApplyDateValue() {
  if (!candidateApplyMonth || !candidateApplyDay || !candidateApplyHour) return "";
  return `${candidateApplyMonth.value}-${candidateApplyDay.value}-${candidateApplyHour.value}`;
}

function resetApplyDateDefault() {
  const now = new Date();
  if (candidateApplyMonth) candidateApplyMonth.value = pad2(now.getMonth() + 1);
  if (candidateApplyDay) candidateApplyDay.value = pad2(now.getDate());
  if (candidateApplyHour) candidateApplyHour.value = pad2(now.getHours());
}

function renderCandidateStatus(candidate) {
  if (candidate.finished || candidate.status === "finished") {
    return `<span class="candidate-status candidate-status--finished">${escapeHtml(ui("admin.status.finished"))}</span>`;
  }
  if (candidate.inProgress || candidate.status === "inProgress") {
    return `<span class="candidate-status candidate-status--active">${escapeHtml(ui("admin.status.active"))}</span>`;
  }
  return `<span class="candidate-status candidate-status--pending">${escapeHtml(ui("admin.status.pending"))}</span>`;
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "-";
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return ui("admin.durationFmtLong", { minutes, seconds: restSeconds });
}

function formatAnswer(answer) {
  if (Array.isArray(answer)) return answer.join(", ") || "-";
  return answer || "-";
}

function reviewStatusLabel(status) {
  const map = {
    已评分: "admin.review.scored",
    通过: "admin.review.pass",
    部分通过: "admin.review.partial",
    未通过: "admin.review.fail",
    待人工复核: "admin.review.manual",
    待评分: "admin.pendingGrade",
  };
  return map[status] ? ui(map[status]) : status || ui("admin.pendingGrade");
}

function formatCodeReviewSummary(grade = {}) {
  const code = grade.code || {};
  if (!code.hasAnswer) return `<span class="review-badge review-badge--empty">${escapeHtml(ui("admin.notAnswered"))}</span>`;
  if (code.autoGraded) {
    const passed = code.passedTests ?? 0;
    const total = code.totalTests ?? 0;
    const scoreText = `${grade.codeScore ?? 0} / ${grade.codeMaxScore ?? 29}`;
    if (passed === total && total > 0) {
      return `<span class="review-badge review-badge--done">${escapeHtml(ui("admin.passed"))} ${scoreText}</span>`;
    }
    if (passed > 0) {
      return `<span class="review-badge review-badge--partial">${passed}/${total} ${escapeHtml(ui("admin.partialPass"))}</span>`;
    }
    return `<span class="review-badge review-badge--fail">${escapeHtml(ui("admin.failed"))} 0 / ${grade.codeMaxScore ?? 29}</span>`;
  }
  if (grade.codeScore === null || grade.codeScore === undefined) {
    return `<span class="review-badge review-badge--pending">${escapeHtml(reviewStatusLabel(code.reviewStatus))}</span>`;
  }
  return `<span class="review-badge review-badge--done">${grade.codeScore} / ${grade.codeMaxScore ?? 29}</span>`;
}

function renderAutoGradeResults(code = {}) {
  const results = code.testResults || [];
  if (!results.length) {
    return `<div class="admin-note">${escapeHtml(ui("admin.noAutoGrade"))}</div>`;
  }

  return `
    <table class="admin-table code-auto-grade-table">
      <thead>
        <tr>
          <th>${escapeHtml(ui("admin.testCase"))}</th>
          <th>${escapeHtml(ui("admin.expected"))}</th>
          <th>${escapeHtml(ui("admin.actual"))}</th>
          <th>${escapeHtml(ui("admin.verdict"))}</th>
        </tr>
      </thead>
      <tbody>
        ${results
          .map(
            (item) => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td><pre class="inline-pre">${escapeHtml(item.expectedOutput || "-")}</pre></td>
                <td><pre class="inline-pre">${escapeHtml(item.actualOutput || "-")}</pre></td>
                <td>${item.passed ? `<span class="review-badge review-badge--done">${escapeHtml(ui("common.correct"))}</span>` : `<span class="review-badge review-badge--fail">${escapeHtml(ui("common.incorrect"))}</span>`}</td>
              </tr>
            `
          )
          .join("")}
      </tbody>
    </table>
  `;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { credentials: "include", ...options });
  const data = await response.json();
  if (response.status === 401) {
    window.location.href = "./login.html";
    throw new Error(data.message || "未登录后台");
  }
  if (!response.ok) throw new Error(data.message || "请求失败");
  return data;
}

async function loadCandidates() {
  candidateTable.innerHTML = `<tr><td colspan="6">${escapeHtml(ui("common.loading"))}</td></tr>`;
  try {
    const data = await requestJson("/api/candidates");
    if (data.candidates.length === 0) {
      candidateTable.innerHTML = `<tr><td colspan="6">${escapeHtml(ui("admin.noCandidates"))}</td></tr>`;
      return;
    }

    const candidates = [...data.candidates].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    candidateTable.innerHTML = candidates
      .map(
        (candidate) => `
          <tr>
            <td>${escapeHtml(candidate.phone)}</td>
            <td>${escapeHtml(window.I18n?.jobLabel(candidate.job) || candidate.job)}</td>
            <td>${formatApplyDateTime(candidate.applyDate)}</td>
            <td>${formatDate(candidate.createdAt)}</td>
            <td>${renderCandidateStatus(candidate)}</td>
            <td><button class="ghost small-button" type="button" data-delete="${candidate.id}">${escapeHtml(ui("common.delete"))}</button></td>
          </tr>
        `
      )
      .join("");
  } catch (error) {
    candidateTable.innerHTML = `<tr><td colspan="6">${escapeHtml(ui("admin.loadFailed", { message: error.message }))}</td></tr>`;
  }
}

async function loadSubmissions() {
  if (adminRole !== "tech") return;
  submissionTable.innerHTML = `<tr><td colspan="9">${escapeHtml(ui("common.loading"))}</td></tr>`;
  try {
    const data = await requestJson("/api/submissions");
    if (data.submissions.length === 0) {
      submissionTable.innerHTML = `<tr><td colspan="9">${escapeHtml(ui("admin.noSubmissions"))}</td></tr>`;
      closeSubmissionDetail();
      return;
    }

    submissionTable.innerHTML = data.submissions
      .map((submission) => {
        const grade = submission.grade || {};
        return `
          <tr>
            <td>${escapeHtml(submission.candidate?.name || "-")}</td>
            <td>${escapeHtml(submission.candidate?.contact || "-")}</td>
            <td>${escapeHtml(window.I18n?.jobLabel(submission.candidate?.role) || submission.candidate?.role || "-")}</td>
            <td>${grade.objectiveScore ?? "-"} / ${grade.objectiveMaxScore ?? "-"}</td>
            <td>${formatCodeReviewSummary(grade)}</td>
            <td>${grade.score ?? "-"} / ${grade.maxScore ?? "-"}</td>
            <td>${formatDuration(grade.elapsedSeconds)}</td>
            <td>${formatDate(submission.submittedAt)}</td>
            <td class="submission-row-actions">
              <button class="ghost small-button" type="button" data-submission="${escapeHtml(submission.id)}">${escapeHtml(ui("common.view"))}</button>
            </td>
          </tr>
        `;
      })
      .join("");
  } catch (error) {
    submissionTable.innerHTML = `<tr><td colspan="9">${escapeHtml(ui("admin.loadFailed", { message: error.message }))}</td></tr>`;
  }
}

function renderCodeReviewSection(submission) {
  const grade = submission.grade || {};
  const code = grade.code || {};
  const codeAnswer = submission.answers?.codeAnswer || "";
  const codeScoreValue = grade.codeScore ?? "";

  return `
    <section class="code-review-panel">
      <div class="code-review-head">
        <h4>${escapeHtml(ui("admin.codeReview"))}</h4>
        <span class="review-badge ${code.hasAnswer ? (code.autoGraded ? (code.passedTests === code.totalTests && code.totalTests > 0 ? "review-badge--done" : code.passedTests > 0 ? "review-badge--partial" : "review-badge--fail") : "review-badge--pending") : "review-badge--empty"}">${escapeHtml(reviewStatusLabel(code.reviewStatus))}</span>
      </div>
      <div class="code-review-meta">
        <div><strong>${escapeHtml(ui("admin.selectedProblem"))}</strong><span>${escapeHtml(code.problemTitle || "-")}</span></div>
        <div><strong>${escapeHtml(ui("admin.language"))}</strong><span>${escapeHtml(code.language || "-")}</span></div>
        <div><strong>${escapeHtml(ui("admin.autoGrade"))}</strong><span>${code.autoGraded ? ui("admin.casesPassedShort", { passed: code.passedTests ?? 0, total: code.totalTests ?? 0 }) : ui("admin.notExecuted")}</span></div>
        <div><strong>${escapeHtml(ui("admin.autoScore"))}</strong><span>${grade.codeScore ?? ui("admin.pendingGrade")} / ${grade.codeMaxScore ?? 29}</span></div>
        <div><strong>${escapeHtml(ui("admin.gradeTime"))}</strong><span>${formatDate(code.autoGradedAt)}</span></div>
        <div><strong>${escapeHtml(ui("admin.manualOverride"))}</strong><span>${code.manualOverride ? ui("common.yes") : ui("common.no")}</span></div>
      </div>
      <div class="code-review-auto">
        <div class="code-review-auto-head">
          <strong>${escapeHtml(ui("admin.autoGradeDetail"))}</strong>
          <button class="ghost small-button" type="button" data-auto-grade="${submission.id}" ${code.hasAnswer ? "" : "disabled"}>${escapeHtml(ui("admin.reAutoGrade"))}</button>
        </div>
        ${renderAutoGradeResults(code)}
        ${code.reviewNote ? `<div class="admin-note">${escapeHtml(code.reviewNote)}</div>` : ""}
      </div>
      <div class="code-review-answer">
        <strong>${escapeHtml(ui("admin.codeAnswer"))}</strong>
        <div class="code-review-pre-wrap">
          <button
            class="copy-icon-button code-review-copy"
            type="button"
            aria-label="${escapeHtml(ui("admin.copyCode"))}"
            title="${escapeHtml(ui("admin.copyCode"))}"
            data-copy-code
            ${code.hasAnswer ? "" : "disabled"}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path
                d="M9 4h8a2 2 0 0 1 2 2v12M7 8H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-1"
                fill="none"
                stroke="currentColor"
                stroke-width="1.8"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
            </svg>
          </button>
          <pre class="code-review-pre">${code.hasAnswer ? escapeHtml(codeAnswer) : escapeHtml(ui("admin.noCodeSubmitted"))}</pre>
        </div>
      </div>
      <form id="codeGradeForm" class="code-review-form">
        <label>
          ${escapeHtml(ui("admin.manualScore"))}
          <input
            id="codeScoreInput"
            type="number"
            min="0"
            max="${grade.codeMaxScore ?? 29}"
            step="1"
            value="${codeScoreValue}"
            placeholder="0 - ${grade.codeMaxScore ?? 29}"
            ${code.hasAnswer ? "" : "disabled"}
          />
        </label>
        <label>
          ${escapeHtml(ui("admin.reviewResult"))}
          <select id="codeReviewStatusInput" ${code.hasAnswer ? "" : "disabled"}>
            <option value="已评分" ${code.reviewStatus === "已评分" ? "selected" : ""}>${escapeHtml(ui("admin.review.scored"))}</option>
            <option value="通过" ${code.reviewStatus === "通过" ? "selected" : ""}>${escapeHtml(ui("admin.review.pass"))}</option>
            <option value="部分通过" ${code.reviewStatus === "部分通过" ? "selected" : ""}>${escapeHtml(ui("admin.review.partial"))}</option>
            <option value="未通过" ${code.reviewStatus === "未通过" ? "selected" : ""}>${escapeHtml(ui("admin.review.fail"))}</option>
            <option value="待人工复核" ${code.reviewStatus === "待人工复核" ? "selected" : ""}>${escapeHtml(ui("admin.review.manual"))}</option>
          </select>
        </label>
        <label class="code-review-note">
          ${escapeHtml(ui("admin.reviewNote"))}
          <textarea id="codeReviewNoteInput" rows="3" placeholder="${escapeHtml(ui("admin.reviewNotePlaceholder"))}" ${code.hasAnswer ? "" : "disabled"}>${escapeHtml(code.reviewNote || "")}</textarea>
        </label>
        <div class="code-review-actions">
          <button type="submit" ${code.hasAnswer ? "" : "disabled"}>${escapeHtml(ui("admin.saveManualGrade"))}</button>
        </div>
      </form>
    </section>
  `;
}

function parseDownloadFilename(disposition) {
  if (!disposition) return "";

  const encodedMatch = disposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    try {
      return decodeURIComponent(encodedMatch[1].trim());
    } catch (error) {
      return encodedMatch[1].trim();
    }
  }

  const plainMatch = disposition.match(/filename="?([^";]+)"?/i);
  return plainMatch?.[1]?.trim() || "";
}

function buildFallbackPdfFilename(submission) {
  const candidate = submission?.candidate || {};
  const name = String(candidate.name || "候选人").replace(/[\\/:*?"<>|]/g, "_");
  const phone = String(candidate.phone || candidate.contact || "").replace(/\D/g, "") || "unknown";
  const date = submission?.submittedAt ? submission.submittedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${name}_${phone}_答题情况_${date}.pdf`;
}

async function exportSubmissionPdf(submission) {
  const exportButton = submissionDetail.querySelector("[data-export-pdf]");
  if (exportButton) {
    exportButton.disabled = true;
    exportButton.textContent = ui("common.exporting");
  }
  setAdminMessage(ui("admin.generatingPdf"), "info");
  try {
    const response = await fetch(`/api/submissions/${encodeURIComponent(submission.id)}/export.pdf`, {
      credentials: "include",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "PDF 导出失败。");
    }
    const filename = parseDownloadFilename(response.headers.get("Content-Disposition")) || buildFallbackPdfFilename(submission);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setAdminMessage(ui("admin.pdfDownloaded"), "success");
  } catch (error) {
    setAdminMessage(error.message || ui("admin.generatingPdf"));
  } finally {
    if (exportButton) {
      exportButton.disabled = false;
      exportButton.textContent = ui("common.exportPdf");
    }
  }
}

function openSubmissionDetailOverlay() {
  if (!submissionDetailOverlay) return;
  submissionDetailOverlay.classList.remove("hidden");
  submissionDetailOverlay.setAttribute("aria-hidden", "false");
  document.body.classList.add("submission-detail-open");
}

function closeSubmissionDetail() {
  if (!submissionDetailOverlay) return;
  submissionDetailOverlay.classList.add("hidden");
  submissionDetailOverlay.setAttribute("aria-hidden", "true");
  document.body.classList.remove("submission-detail-open");
}

function renderSubmissionDetail(submission, { open = true } = {}) {
  activeSubmission = submission;
  activeSubmissionId = submission.id;
  const grade = submission.grade || {};
  const code = grade.code || {};
  const rows = (grade.details || [])
    .map(
      (item) => `
        <tr>
          <td>${item.no}</td>
          <td>${escapeHtml(item.title)}</td>
          <td>${escapeHtml(formatAnswer(item.submittedAnswer))}</td>
          <td>${escapeHtml(formatAnswer(item.expectedAnswer))}</td>
          <td>${item.score} / ${item.maxScore}</td>
          <td>${item.isCorrect ? escapeHtml(ui("common.correct")) : item.score > 0 ? escapeHtml(ui("common.partial")) : escapeHtml(ui("common.incorrect"))}</td>
        </tr>
      `
    )
    .join("");

  submissionDetail.innerHTML = `
    <div class="submission-detail-head">
      <div>
        <h3 id="submissionDetailTitle">${escapeHtml(ui("admin.submissionDetail", { name: submission.candidate?.name || "-" }))}</h3>
        <p>${escapeHtml(ui("admin.submissionMeta", {
          role: window.I18n?.jobLabel(submission.candidate?.role) || submission.candidate?.role || "-",
          contact: submission.candidate?.contact || "-",
          duration: formatDuration(grade.elapsedSeconds),
        }))}</p>
      </div>
      <strong>${grade.score ?? "-"} / ${grade.maxScore ?? "-"}</strong>
    </div>
    <div class="admin-note">
      ${escapeHtml(ui("admin.objectiveSummary", { score: grade.objectiveScore ?? "-", max: grade.objectiveMaxScore ?? "-" }))}
      ${escapeHtml(ui("admin.codeSummary", {
        score: grade.codeScore ?? ui("admin.pendingGrade"),
        max: grade.codeMaxScore ?? 29,
        detail: code.autoGraded
          ? ui("admin.casesPassed", { passed: code.passedTests ?? 0, total: code.totalTests ?? 0 })
          : ui("admin.notAutoGraded"),
      }))}
    </div>
    ${renderIntegritySection(submission)}
    ${adminRole === "tech" ? renderCodeReviewSection(submission) : ""}
    <h4 class="submission-section-title">${escapeHtml(ui("admin.objectiveDetail"))}</h4>
    <table class="admin-table">
      <thead>
        <tr>
          <th>${escapeHtml(ui("admin.col.qNo"))}</th>
          <th>${escapeHtml(ui("admin.col.qTitle"))}</th>
          <th>${escapeHtml(ui("admin.col.answer"))}</th>
          <th>${escapeHtml(ui("admin.col.standard"))}</th>
          <th>${escapeHtml(ui("admin.col.qScore"))}</th>
          <th>${escapeHtml(ui("admin.col.qVerdict"))}</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="submission-export-actions">
      <button class="ghost small-button" type="button" data-export-pdf>${escapeHtml(ui("common.exportPdf"))}</button>
      ${adminRole === "tech" ? `<button class="ghost small-button danger-button" type="button" data-delete-submission="${escapeHtml(submission.id)}">${escapeHtml(ui("common.delete"))}</button>` : ""}
    </div>
  `;
  if (open) {
    openSubmissionDetailOverlay();
  }
}

async function saveCodeGrade(event) {
  event.preventDefault();
  if (!activeSubmissionId) return;

  const codeScore = document.querySelector("#codeScoreInput")?.value;
  const reviewStatus = document.querySelector("#codeReviewStatusInput")?.value;
  const reviewNote = document.querySelector("#codeReviewNoteInput")?.value.trim();

  try {
    const data = await requestJson(`/api/submissions/${encodeURIComponent(activeSubmissionId)}/code-grade`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codeScore, reviewStatus, reviewNote }),
    });
    setAdminMessage(ui("admin.codeGradeSaved"), "success");
    renderSubmissionDetail(data.submission);
    await loadSubmissions();
  } catch (error) {
    setAdminMessage(error.message);
  }
}

candidateForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncCandidatePhoneInput();

  const phone = normalizeCandidatePhone(candidatePhoneInput?.value);
  if (!isValidCandidatePhone(phone)) {
    setAdminMessage(ui("admin.invalidPhone"));
    candidatePhoneInput?.focus();
    return;
  }

  setAdminMessage(ui("admin.saving"), "info");

  try {
    const data = await requestJson("/api/candidates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone,
        job: document.querySelector("#candidateJob").value,
        applyDate: getApplyDateValue(),
      }),
    });
    setAdminMessage(ui("admin.saved", { phone: data.candidate.phone, job: window.I18n?.jobLabel(data.candidate.job) || data.candidate.job }), "success");
    candidateForm.reset();
    resetApplyDateDefault();
    await loadCandidates();
  } catch (error) {
    setAdminMessage(error.message);
  }
});

candidateTable.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-delete]");
  if (!button) return;

  const confirmed = await showConfirm(ui("admin.deleteConfirmTitle"), ui("admin.deleteConfirmMessage"), ui("common.delete"), ui("common.cancel"));
  if (!confirmed) return;

  try {
    await requestJson(`/api/candidates/${encodeURIComponent(button.dataset.delete)}`, { method: "DELETE" });
    setAdminMessage(ui("admin.deleted"), "success");
    await loadCandidates();
  } catch (error) {
    setAdminMessage(error.message);
  }
});

async function deleteSubmissionRecord(submissionId, candidateName, deleteButton) {
  if (adminRole !== "tech") {
    setTechMessage(ui("admin.deleteSubmissionForbidden"));
    return;
  }
  if (!submissionId) {
    setTechMessage(ui("admin.deleteSubmissionFailed"));
    return;
  }

  const confirmed = await showConfirm(
    ui("admin.deleteSubmissionTitle"),
    ui("admin.deleteSubmissionMessage", { name: candidateName || "-" }),
    ui("common.delete"),
    ui("common.cancel")
  );
  if (!confirmed) return;

  if (deleteButton) deleteButton.disabled = true;
  try {
    await requestJson(`/api/submissions/${encodeURIComponent(submissionId)}`, { method: "DELETE" });
    closeSubmissionDetail();
    activeSubmissionId = "";
    activeSubmission = null;
    setTechMessage(ui("admin.deleteSubmissionDone"), "success");
    setAdminMessage(ui("admin.deleteSubmissionDone"), "success");
  } catch (error) {
    setTechMessage(error.message);
    setAdminMessage(error.message);
    if (deleteButton) deleteButton.disabled = false;
    return;
  }

  try {
    await loadSubmissions();
  } catch (error) {
    setTechMessage(error.message);
  }
}

submissionTable?.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-submission]");
  if (!button) return;

  try {
    const data = await requestJson(`/api/submissions/${encodeURIComponent(button.dataset.submission)}`);
    renderSubmissionDetail(data.submission);
  } catch (error) {
    setAdminMessage(error.message);
  }
});

async function autoGradeSubmission(submissionId) {
  setAdminMessage(ui("admin.autoGrading"), "info");
  try {
    const data = await requestJson(`/api/submissions/${encodeURIComponent(submissionId)}/auto-grade-code`, {
      method: "POST",
    });
    setAdminMessage(ui("admin.autoGradeDone"), "success");
    renderSubmissionDetail(data.submission);
    await loadSubmissions();
  } catch (error) {
    setAdminMessage(error.message);
  }
}

async function copyCodeAnswer(button) {
  const pre = button.closest(".code-review-pre-wrap")?.querySelector(".code-review-pre");
  const text = pre?.textContent || "";
  if (!text || text === ui("admin.noCodeSubmitted")) return;

  try {
    await navigator.clipboard.writeText(text);
  } catch (error) {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }

  const originalLabel = ui("admin.copyCode");
  button.setAttribute("title", ui("admin.copied"));
  button.setAttribute("aria-label", ui("admin.copied"));
  window.setTimeout(() => {
    button.setAttribute("title", originalLabel);
    button.setAttribute("aria-label", originalLabel);
  }, 1500);
}

submissionDetail?.addEventListener("click", async (event) => {
  const deleteButton = event.target.closest("[data-delete-submission]");
  if (deleteButton) {
    event.preventDefault();
    event.stopPropagation();
    await deleteSubmissionRecord(
      deleteButton.dataset.deleteSubmission || activeSubmissionId,
      activeSubmission?.candidate?.name || "-",
      deleteButton
    );
    return;
  }

  const exportButton = event.target.closest("[data-export-pdf]");
  if (exportButton) {
    if (!activeSubmission) return;
    await exportSubmissionPdf(activeSubmission);
    return;
  }

  const copyButton = event.target.closest("[data-copy-code]");
  if (copyButton) {
    if (copyButton.disabled) return;
    await copyCodeAnswer(copyButton);
    return;
  }

  const autoGradeButton = event.target.closest("[data-auto-grade]");
  if (!autoGradeButton || autoGradeButton.disabled) return;
  await autoGradeSubmission(autoGradeButton.dataset.autoGrade);
});

submissionDetail?.addEventListener("submit", (event) => {
  if (event.target.id === "codeGradeForm") saveCodeGrade(event);
});

async function loadExamSummary() {
  if (!examSummaryTable) return;
  try {
    const data = await requestJson("/api/admin/exams");
    examSummaryTable.innerHTML = data.exams
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(window.I18n?.jobLabel(item.job) || item.job)}</td>
            <td>${escapeHtml(item.title || ui("admin.notConfigured"))}</td>
            <td>${item.durationMinutes ? ui("admin.durationFmt", { minutes: item.durationMinutes }) : "-"}</td>
            <td>${ui("admin.codeCount", { objective: item.questionCount ?? 0, code: item.codeProblemCount ?? 0 })}</td>
            <td>${formatDate(item.updatedAt)}</td>
            <td>
              <button class="ghost small-button" type="button" data-export-exam="${escapeHtml(item.job)}">${escapeHtml(ui("admin.exportExamPdf"))}</button>
            </td>
          </tr>
        `
      )
      .join("");
  } catch (error) {
    examSummaryTable.innerHTML = `<tr><td colspan="6">${escapeHtml(ui("admin.loadFailed", { message: error.message }))}</td></tr>`;
  }
}

async function exportExamPdf(job) {
  setAdminMessage(ui("admin.generatingPdf"), "info");
  try {
    const response = await fetch(`/api/admin/exams/export.pdf?job=${encodeURIComponent(job)}`, {
      credentials: "include",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || "PDF 导出失败。");
    }
    const filename = parseDownloadFilename(response.headers.get("Content-Disposition")) || `${job}_exam.pdf`;
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setAdminMessage(ui("admin.examPdfDownloaded"), "success");
  } catch (error) {
    setAdminMessage(error.message);
  }
}

function buildStemQuestionList(paper) {
  const items = [];
  let no = 0;
  for (const section of paper?.sections || []) {
    for (const question of section.questions || []) {
      no += 1;
      items.push({
        id: question.id,
        no,
        kind: "objective",
        sectionTitle: section.title,
        title: question.title,
        question,
      });
    }
  }
  for (const problem of paper?.codeProblems || []) {
    no += 1;
    items.push({
      id: problem.id,
      no,
      kind: "code",
      sectionTitle: ui("exam.codeCategory"),
      title: problem.title,
      question: problem,
    });
  }
  return items;
}

function renderStemQuestionList() {
  if (!stemQuestionList) return;
  stemQuestionList.innerHTML = activeStemQuestions
    .map(
      (item) => `
        <button type="button" class="stem-question-item ${activeStemQuestion?.id === item.id ? "is-active" : ""}" data-stem-id="${escapeHtml(item.id)}">
          <strong>${item.no}. ${escapeHtml(item.sectionTitle || "")}</strong>
          <span>${escapeHtml(String(item.title || "").slice(0, 80))}${String(item.title || "").length > 80 ? "..." : ""}</span>
        </button>
      `
    )
    .join("");
}

function openStemEditor(questionItem) {
  activeStemQuestion = questionItem;
  renderStemQuestionList();
  stemEditForm?.classList.remove("hidden");
  if (stemEditQuestionId) stemEditQuestionId.value = questionItem.id;
  if (stemEditTitle) stemEditTitle.value = questionItem.question.title || "";

  const isCode = questionItem.kind === "code";
  stemPromptField?.classList.toggle("hidden", isCode || !questionItem.question.prompt);
  stemOptionsField?.classList.toggle("hidden", isCode || !Array.isArray(questionItem.question.options));
  stemBodyField?.classList.toggle("hidden", !isCode);

  if (stemEditPrompt) stemEditPrompt.value = questionItem.question.prompt || "";
  if (stemEditOptions) stemEditOptions.value = (questionItem.question.options || []).join("\n");
  if (stemEditBody) stemEditBody.value = JSON.stringify(questionItem.question.body || [], null, 2);
}

async function loadStemPaper() {
  const job = stemEditJob?.value;
  if (!job) return;
  setAdminMessage(ui("admin.loadingStemPaper"), "info");
  try {
    const data = await requestJson(`/api/admin/exams/paper?job=${encodeURIComponent(job)}`);
    activeStemPaper = data.paper;
    activeStemExamId = data.examId;
    activeStemQuestions = buildStemQuestionList(data.paper);
    activeStemQuestion = null;
    stemEditorLayout?.classList.remove("hidden");
    stemEditForm?.classList.add("hidden");
    renderStemQuestionList();
    setAdminMessage(ui("admin.stemPaperLoaded"), "success");
  } catch (error) {
    setAdminMessage(error.message);
  }
}

async function saveStemChanges(event) {
  event.preventDefault();
  if (!activeStemPaper || !activeStemExamId || !activeStemQuestion) return;

  const change = { id: activeStemQuestion.id, title: stemEditTitle?.value.trim() || "" };
  if (activeStemQuestion.kind === "code") {
    try {
      change.body = JSON.parse(stemEditBody?.value || "[]");
    } catch (error) {
      setAdminMessage(ui("admin.stemBodyInvalid"));
      return;
    }
  } else {
    if (!stemPromptField?.classList.contains("hidden") && stemEditPrompt) {
      change.prompt = stemEditPrompt.value.trim();
    }
    if (!stemOptionsField?.classList.contains("hidden") && stemEditOptions) {
      change.options = stemEditOptions.value
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }

  const confirmed = await showConfirm(ui("admin.saveStemConfirmTitle"), ui("admin.saveStemConfirmMessage"));
  if (!confirmed) return;

  try {
    await requestJson("/api/admin/exams/paper", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        job: stemEditJob?.value,
        examId: activeStemExamId,
        changes: [change],
      }),
    });
    setAdminMessage(ui("admin.stemSaved"), "success");
    await loadStemPaper();
    await loadExamSummary();
  } catch (error) {
    setAdminMessage(error.message);
  }
}

function renderImportPreview(paper, warnings = [], parseMethod = "") {
  if (!examImportPreview) return;
  const objectiveCount = (paper.sections || []).reduce((sum, section) => sum + (section.questions?.length || 0), 0);
  examImportPreview.innerHTML = `
    <div class="admin-note">
      ${escapeHtml(ui("admin.parseMethod", { method: parseMethod || "template" }))}
      ${escapeHtml(ui("admin.parseCounts", { objective: objectiveCount, code: paper.codeProblems?.length || 0 }))}
      ${warnings.length ? `<br/>${escapeHtml(ui("admin.parseWarn", { warnings: warnings.join(" ") }))}` : ""}
    </div>
    <p><strong>${escapeHtml(paper.title || ui("admin.unnamedExam"))}</strong> · ${escapeHtml(ui("admin.examDurationShort", { minutes: paper.durationMinutes || 40 }))}</p>
    <ul class="import-preview-list">
      ${(paper.sections || [])
        .map(
          (section) => `
            <li>${escapeHtml(ui("admin.sectionCount", { title: section.title, count: section.questions?.length || 0 }))}</li>
          `
        )
        .join("")}
      ${(paper.codeProblems || []).map((problem) => `<li>${escapeHtml(ui("admin.codeProblemLabel", { title: problem.title }))}</li>`).join("")}
    </ul>
  `;
  examImportPreview.classList.remove("hidden");
  publishExamButton?.removeAttribute("disabled");
}

examImportForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fileInput = document.querySelector("#examImportFile");
  const file = fileInput?.files?.[0];
  if (!file) {
    setAdminMessage(ui("admin.selectFile"));
    return;
  }

  const formData = new FormData();
  formData.append("job", document.querySelector("#examImportJob").value);
  formData.append("durationMinutes", document.querySelector("#examImportDuration").value || "40");
  formData.append("title", document.querySelector("#examImportTitle").value.trim());
  formData.append("file", file);

  setAdminMessage(ui("admin.parsingExam"), "info");
  publishExamButton?.setAttribute("disabled", "true");
  try {
    const response = await fetch("/api/exams/import", {
      method: "POST",
      credentials: "include",
      body: formData,
    });
    const data = await response.json();
    if (!response.ok || !data.draftId) {
      throw new Error(data.message || "导入解析失败。");
    }
    activeImportDraftId = data.draftId;
    renderImportPreview(data.paper, data.warnings, data.parseMethod);
    setAdminMessage(data.ok ? ui("admin.parseDone") : ui("admin.parseDoneWarn"), data.ok ? "success" : "info");
  } catch (error) {
    setAdminMessage(error.message);
    examImportPreview?.classList.add("hidden");
  }
});

publishExamButton?.addEventListener("click", async () => {
  if (!activeImportDraftId) return;
  const job = document.querySelector("#examImportJob").value;
  const confirmed = await showConfirm(
    ui("admin.publishConfirmTitle"),
    ui("admin.publishConfirmMessage", { job: window.I18n?.jobLabel(job) || job }),
    ui("admin.publish"),
    ui("common.cancel")
  );
  if (!confirmed) return;

  try {
    await requestJson("/api/exams/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ draftId: activeImportDraftId, job }),
    });
    setAdminMessage(ui("admin.publishedShort"), "success");
    activeImportDraftId = null;
    examImportForm?.reset();
    examImportPreview?.classList.add("hidden");
    publishExamButton?.setAttribute("disabled", "true");
    await loadExamSummary();
  } catch (error) {
    setAdminMessage(error.message);
  }
});

examMgmtSection?.addEventListener("click", async (event) => {
  const exportButton = event.target.closest("[data-export-exam]");
  if (exportButton) {
    await exportExamPdf(exportButton.dataset.exportExam);
  }
});

loadStemPaperButton?.addEventListener("click", loadStemPaper);
stemQuestionList?.addEventListener("click", (event) => {
  const button = event.target.closest("[data-stem-id]");
  if (!button) return;
  const item = activeStemQuestions.find((entry) => entry.id === button.dataset.stemId);
  if (item) openStemEditor(item);
});
stemEditForm?.addEventListener("submit", saveStemChanges);

submissionDetailOverlay?.addEventListener("click", (event) => {
  if (event.target.closest("[data-close-submission-detail]")) {
    closeSubmissionDetail();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && submissionDetailOverlay && !submissionDetailOverlay.classList.contains("hidden")) {
    closeSubmissionDetail();
  }
});

refreshButton.addEventListener("click", loadCandidates);
refreshSubmissionsButton?.addEventListener("click", loadSubmissions);
adminLogoutButton?.addEventListener("click", async () => {
  try {
    await fetch("/api/admin/logout", { method: "POST", credentials: "include" });
  } catch (error) {
    // ignore network failures and still leave admin
  }
  window.location.href = "./login.html";
});
initApplyDatePicker();
candidatePhoneInput?.addEventListener("input", syncCandidatePhoneInput);
candidatePhoneInput?.addEventListener("blur", syncCandidatePhoneInput);

async function bootAdmin() {
  try {
    const session = await requestJson("/api/admin/session");
    configureAdminNavigation(session.role || "hr");
  } catch (error) {
    window.location.href = "./login.html";
    return;
  }
  await loadCandidates();
  if (adminRole === "tech") {
    await loadSubmissions();
    await loadExamSummary();
  }
}

bootAdmin();

window.addEventListener("site-lang-change", async () => {
  window.I18n?.applyDom();
  configureAdminNavigation(adminRole);
  await loadCandidates();
  if (adminRole === "tech") {
    await loadSubmissions();
    await loadExamSummary();
  }
  if (activeSubmission) {
    const overlayOpen = submissionDetailOverlay && !submissionDetailOverlay.classList.contains("hidden");
    renderSubmissionDetail(activeSubmission, { open: overlayOpen });
  }
});
