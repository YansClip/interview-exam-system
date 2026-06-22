const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn } = require("child_process");
const { promisify } = require("util");

const execFile = promisify(require("child_process").execFile);

const examStore = require("./exam-store");
const { generateSubmissionPdfBuffer, buildSubmissionExportFilename } = require("./submission-pdf");
const { generateExamPdfBuffer, buildExamExportFilename } = require("./exam-pdf");
const { parseExamTemplate } = require("./exam-import-parser");
const { parseExamWithAi } = require("./exam-ai-parser");
const { readMultipartRequest } = require("./multipart");
const mammoth = require("mammoth");
const pdfParse = require("pdf-parse");

const rootDir = __dirname;
const dataDir = path.join(rootDir, "data");
const candidatesFile = path.join(dataDir, "candidates.json");
const submissionsFile = path.join(dataDir, "submissions.json");
const examsFile = path.join(dataDir, "exams.json");
const port = Number(process.env.PORT || 8787);
const NODE_ENV = process.env.NODE_ENV || "development";
const jobs = ["大模型工程师", "游戏策划师", "全栈工程师"];
const ALLOW_TEST_PHONE = process.env.ALLOW_TEST_PHONE === "1" || (NODE_ENV !== "production" && process.env.ALLOW_TEST_PHONE !== "0");
const ADMIN_HR_PASSWORD = process.env.ADMIN_HR_PASSWORD || (NODE_ENV === "production" ? "" : "yunqi");
const ADMIN_TECH_PASSWORD =
  process.env.ADMIN_TECH_PASSWORD ||
  process.env.ADMIN_PASSWORD ||
  (NODE_ENV === "production" ? "" : "yunqis");
const ANTICHEAT_FORCE_SUBMIT_THRESHOLD = Number(process.env.ANTICHEAT_FORCE_SUBMIT_THRESHOLD || 5);
const ANTICHEAT_WARN_THRESHOLD = Number(process.env.ANTICHEAT_WARN_THRESHOLD || 1);
const ANTICHEAT_LOCK_THRESHOLD = Number(process.env.ANTICHEAT_LOCK_THRESHOLD || 3);
const ANTICHEAT_LEAVE_GRACE_MS = Number(process.env.ANTICHEAT_LEAVE_GRACE_MS || 10000);
const ADMIN_COOKIE_NAME = "exam_system_admin_session";
const EXAM_COOKIE_NAME = "exam_system_session";
const EXAM_DURATION_SECONDS = 60 * 60;
const EXAM_SUBMIT_GRACE_SECONDS = 120;
const EXAM_SESSION_MAX_AGE_SECONDS = EXAM_DURATION_SECONDS + 30 * 60;
const ADMIN_SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const ADMIN_LOGIN_MAX_ATTEMPTS = 8;
const ADMIN_LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const RUN_CODE_MAX_PER_MINUTE = 30;
const ENABLE_CODE_RUNNER = process.env.ENABLE_CODE_RUNNER === "1";
const adminSessions = new Map();
const examSessions = new Map();
const adminLoginAttempts = new Map();
const runCodeUsage = new Map();
const fileLocks = new Map();

if (NODE_ENV === "production" && !ADMIN_TECH_PASSWORD) {
  console.error("[安全] 生产环境必须设置 ADMIN_TECH_PASSWORD（或 ADMIN_PASSWORD）环境变量后启动。");
  process.exit(1);
}

if (NODE_ENV === "production" && !ADMIN_HR_PASSWORD) {
  console.error("[安全] 生产环境必须设置 ADMIN_HR_PASSWORD 环境变量后启动。");
  process.exit(1);
}

if (NODE_ENV === "production" && ALLOW_TEST_PHONE) {
  console.error("[安全] 生产环境禁止启用 ALLOW_TEST_PHONE=1。");
  process.exit(1);
}

const BLOCKED_STATIC_PREFIXES = ["/data/", "/node_modules/"];
const BLOCKED_STATIC_FILES = new Set([
  "/server.js",
  "/package.json",
  "/package-lock.json",
  "/README.md",
  "/default-exam-paper.js",
  "/exam-store.js",
  "/submission-pdf.js",
  "/exam-pdf.js",
  "/exam-import-parser.js",
  "/exam-ai-parser.js",
  "/multipart.js",
]);

examStore.ensureExamStore();

function resolveSubmissionPaper(submission) {
  if (submission?.examId) {
    const paper = examStore.getExamPaper(submission.examId);
    if (paper) return paper;
  }
  return examStore.getActiveExamPaper(submission?.candidate?.role);
}

function resolveSessionPaper(session) {
  if (session?.examId) {
    const paper = examStore.getExamPaper(session.examId);
    if (paper) return paper;
  }
  return examStore.getActiveExamPaper(session?.job);
}

async function extractTextFromUpload(file) {
  if (!file?.data?.length) throw new Error("未收到文件。");
  const name = String(file.filename || "").toLowerCase();
  if (name.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.data });
    return result.value || "";
  }
  if (name.endsWith(".pdf")) {
    const result = await pdfParse(file.data);
    return result.text || "";
  }
  throw new Error("仅支持 .docx 或 .pdf 文件。");
}

async function parseUploadedExamText(text) {
  const templateResult = parseExamTemplate(text);
  if (templateResult.ok) return templateResult;
  const aiResult = await parseExamWithAi(text);
  if (aiResult.ok) {
    return {
      ...aiResult,
      errors: [...templateResult.errors, "已使用智能解析兜底。"],
    };
  }
  return {
    ok: false,
    errors: [...templateResult.errors, ...aiResult.errors],
    paper: templateResult.paper,
    parseMethod: "failed",
  };
}

const RUN_TIMEOUT_MS = 8000;
const MAX_CODE_LENGTH = 50000;
const MAX_INPUT_LENGTH = 20000;
const MAX_OUTPUT_LENGTH = 50000;
const allowedRunLanguages = ["Python", "C++", "Java"];
const notifyOnSubmit = process.env.NOTIFY_ON_SUBMIT !== "0" && process.platform === "darwin";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function withFileLock(filePath, task) {
  const previous = fileLocks.get(filePath) || Promise.resolve();
  const next = previous.then(task, task);
  fileLocks.set(
    filePath,
    next.catch(() => {}),
  );
  return next;
}

function ensureDataFile() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(candidatesFile)) fs.writeFileSync(candidatesFile, "[]\n", "utf8");
  if (!fs.existsSync(submissionsFile)) fs.writeFileSync(submissionsFile, "[]\n", "utf8");
}

function readJsonArray(filePath) {
  ensureDataFile();
  const content = fs.readFileSync(filePath, "utf8");
  const parsed = JSON.parse(content);
  if (!Array.isArray(parsed)) {
    throw new Error(`数据文件格式错误：${path.basename(filePath)}`);
  }
  return parsed;
}

function writeJsonArray(filePath, rows) {
  ensureDataFile();
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(rows, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, filePath);
}

function readCandidates() {
  return readJsonArray(candidatesFile);
}

function writeCandidates(candidates) {
  writeJsonArray(candidatesFile, candidates);
}

function readSubmissions() {
  return readJsonArray(submissionsFile);
}

function writeSubmissions(submissions) {
  writeJsonArray(submissionsFile, submissions);
}

function normalizePhone(phone) {
  return String(phone || "").trim().replace(/\D/g, "");
}

function isValidCandidatePhone(phone) {
  const normalized = normalizePhone(phone);
  return /^1[3-9]\d{9}$/.test(normalized);
}

function normalizeJob(job) {
  return String(job || "").trim();
}

function normalizeApplyDate(value) {
  const text = String(value || "").trim();
  const match = /^(\d{2})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return "";

  const month = Number(match[1]);
  const day = Number(match[2]);
  const hour = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23) return "";

  const year = new Date().getFullYear();
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return "";
  }

  return `${match[1]}-${match[2]}-${match[3]}`;
}

function getCandidatesForAdmin() {
  const finishedKeys = new Set();
  readSubmissions().forEach((submission) => {
    finishedKeys.add(candidateKey(submission.candidate?.contact, submission.candidate?.role));
  });

  const inProgressKeys = new Set();
  for (const session of examSessions.values()) {
    if (!hasSubmitted(session.phone, session.job)) {
      inProgressKeys.add(candidateKey(session.phone, session.job));
    }
  }

  return readCandidates().map((candidate) => {
    const key = candidateKey(candidate.phone, candidate.job);
    const finished = finishedKeys.has(key);
    const inProgress = !finished && inProgressKeys.has(key);
    return {
      ...candidate,
      finished,
      inProgress,
      status: finished ? "finished" : inProgress ? "inProgress" : "pending",
    };
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(JSON.stringify(payload));
}

function parseCookies(cookieHeader) {
  const raw = String(cookieHeader || "");
  const cookies = {};
  raw.split(";").forEach((part) => {
    const [key, ...rest] = part.trim().split("=");
    if (!key) return;
    cookies[key] = decodeURIComponent(rest.join("=") || "");
  });
  return cookies;
}

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

function getClientIp(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || request.socket?.remoteAddress || "unknown";
}

function isSecureRequest(request) {
  if (process.env.FORCE_SECURE_COOKIES === "1") return true;
  const proto = String(request.headers["x-forwarded-proto"] || "").toLowerCase();
  return proto === "https";
}

function buildCookie(name, value, maxAgeSeconds, request) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (isSecureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function buildClearCookie(name, request) {
  return buildCookie(name, "", 0, request);
}

function setAdminSessionCookie(response, token, request) {
  response.setHeader("Set-Cookie", buildCookie(ADMIN_COOKIE_NAME, token, ADMIN_SESSION_MAX_AGE_SECONDS, request));
}

function clearAdminSessionCookie(response, request) {
  response.setHeader("Set-Cookie", buildClearCookie(ADMIN_COOKIE_NAME, request));
}

function setExamSessionCookie(response, token, request) {
  response.setHeader("Set-Cookie", buildCookie(EXAM_COOKIE_NAME, token, EXAM_SESSION_MAX_AGE_SECONDS, request));
}

function clearExamSessionCookie(response, request) {
  response.setHeader("Set-Cookie", buildClearCookie(EXAM_COOKIE_NAME, request));
}

function isAdminTestPhone(phone) {
  return ALLOW_TEST_PHONE && normalizePhone(phone) === "123";
}

function isPhoneAllowed(phone, job) {
  if (isAdminTestPhone(phone)) return true;
  return readCandidates().some((candidate) => candidate.phone === phone && candidate.job === job);
}

function hasSubmitted(phone, job) {
  if (isAdminTestPhone(phone)) return false;
  const key = candidateKey(phone, job);
  return readSubmissions().some((submission) => candidateKey(submission.candidate?.contact, submission.candidate?.role) === key);
}

function getExamSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[EXAM_COOKIE_NAME];
  if (!token) return null;
  const session = examSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    examSessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function requireExamSession(request, response) {
  const session = getExamSession(request);
  if (session) return session;
  sendJson(response, 401, { ok: false, message: "登录已失效，请重新登录。" });
  return null;
}

function getExamRemainingSeconds(session) {
  const durationSeconds = session.durationSeconds || EXAM_DURATION_SECONDS;
  const startedAt = new Date(session.startedAt).getTime();
  if (!startedAt) return durationSeconds;
  const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  return Math.max(0, durationSeconds - elapsedSeconds);
}

function publicExamSession(session) {
  const paper = resolveSessionPaper(session);
  const isTester = isAdminTestPhone(session.phone);
  return {
    username: session.username,
    phone: session.phone,
    job: session.job,
    examId: session.examId || paper?.id || null,
    loginAt: session.loginAt,
    startedAt: session.startedAt,
    remainingSeconds: getExamRemainingSeconds(session),
    durationMinutes: paper?.durationMinutes || Math.round((session.durationSeconds || EXAM_DURATION_SECONDS) / 60),
    isAdminTester: isTester,
    antiCheat: {
      warnThreshold: ANTICHEAT_WARN_THRESHOLD,
      lockThreshold: ANTICHEAT_LOCK_THRESHOLD,
      forceSubmitThreshold: ANTICHEAT_FORCE_SUBMIT_THRESHOLD,
      leaveGraceMs: ANTICHEAT_LEAVE_GRACE_MS,
      relaxed: false,
    },
  };
}

const LOGIN_DENIED_MESSAGE = "无法登录，请核对姓名、手机号与岗位，或联系 HR。";

function mergeIntegrityCountsMonotonic(current = {}, incoming = {}) {
  const merged = { ...current };
  for (const [key, value] of Object.entries(incoming || {})) {
    const next = Number(value);
    const prev = Number(merged[key]) || 0;
    if (Number.isFinite(next)) {
      merged[key] = Math.max(prev, next);
    }
  }
  return merged;
}

function mergeExamIntegrity(session, payload = {}) {
  const current = session.integrity || { violationCount: 0, events: [], counts: {}, forcedSubmit: false };
  const incomingEvents = Array.isArray(payload.events) ? payload.events : [];
  const seen = new Set((current.events || []).map((item) => `${item.type}|${item.at}|${item.detail}`));
  const appendedEvents = incomingEvents.filter((item) => {
    const key = `${item.type}|${item.at}|${item.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const events = [...(current.events || []), ...appendedEvents].slice(-200);
  const counts = mergeIntegrityCountsMonotonic(current.counts, payload.counts);

  let violationCount = Number(current.violationCount) || 0;
  const incomingCount = Number(payload.violationCount);
  if (Number.isFinite(incomingCount)) {
    violationCount = Math.max(violationCount, incomingCount);
  }

  return {
    violationCount,
    events,
    counts,
    forcedSubmit: Boolean(current.forcedSubmit || payload.forcedSubmit),
    lastReportAt: new Date().toISOString(),
  };
}

function publicSubmissionResult(submission) {
  return {
    ok: true,
    submittedAt: submission.submittedAt,
    score: submission.grade?.score ?? null,
    maxScore: submission.grade?.maxScore ?? null,
  };
}

function checkAdminLoginRateLimit(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const bucket = adminLoginAttempts.get(ip);
  if (!bucket || now > bucket.resetAt) {
    adminLoginAttempts.set(ip, { count: 0, resetAt: now + ADMIN_LOGIN_LOCKOUT_MS });
    return true;
  }
  if (bucket.count >= ADMIN_LOGIN_MAX_ATTEMPTS) return false;
  return true;
}

function recordAdminLoginFailure(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const bucket = adminLoginAttempts.get(ip);
  if (!bucket || now > bucket.resetAt) {
    adminLoginAttempts.set(ip, { count: 1, resetAt: now + ADMIN_LOGIN_LOCKOUT_MS });
    return;
  }
  bucket.count += 1;
}

function clearAdminLoginFailures(request) {
  adminLoginAttempts.delete(getClientIp(request));
}

function checkRunCodeRateLimit(token) {
  const now = Date.now();
  let bucket = runCodeUsage.get(token);
  if (!bucket || now > bucket.resetAt) {
    bucket = { count: 0, resetAt: now + 60_000 };
    runCodeUsage.set(token, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RUN_CODE_MAX_PER_MINUTE;
}

function getAdminSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[ADMIN_COOKIE_NAME];
  if (!token) return null;
  const session = adminSessions.get(token);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    adminSessions.delete(token);
    return null;
  }
  return { token, role: session.role, expiresAt: session.expiresAt };
}

function isAdminAuthed(request) {
  return Boolean(getAdminSession(request));
}

function resolveAdminRoleFromPassword(password) {
  if (password && password === ADMIN_HR_PASSWORD) return "hr";
  if (password && password === ADMIN_TECH_PASSWORD) return "tech";
  return null;
}

function adminRoleAllowed(sessionRole, requiredRole) {
  if (!sessionRole) return false;
  if (requiredRole === "tech") return sessionRole === "tech";
  return sessionRole === "tech" || sessionRole === "hr";
}

function requireAdmin(request, response, requiredRole = "hr") {
  const session = getAdminSession(request);
  if (!session) {
    sendJson(response, 401, { ok: false, message: "未登录后台，请从登录页进入后台管理。" });
    return null;
  }
  if (!adminRoleAllowed(session.role, requiredRole)) {
    sendJson(response, 403, { ok: false, message: "当前账号无权执行此操作。" });
    return null;
  }
  return session;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求内容过大"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON 格式不正确"));
      }
    });
    request.on("error", reject);
  });
}

function candidateKey(phone, job) {
  return `${normalizePhone(phone)}__${normalizeJob(job)}`;
}

function normalizeAnswer(value) {
  return String(value || "")
    .toUpperCase()
    .replaceAll("→", "")
    .replaceAll(">", "")
    .replaceAll("-", "")
    .replaceAll(" ", "")
    .replaceAll(",", "")
    .replaceAll("，", "")
    .trim();
}

function uniqueSorted(values) {
  return [...new Set(Array.isArray(values) ? values : [])].sort();
}

function scoreChoice(question, answer) {
  if (question.type === "single") {
    const correct = answer === question.answer;
    return {
      score: correct ? question.score : 0,
      isCorrect: correct,
      expectedAnswer: question.answer,
    };
  }

  const expected = uniqueSorted(question.answer);
  const submitted = uniqueSorted(answer);
  const hasWrong = submitted.some((item) => !expected.includes(item));
  const correctCount = submitted.filter((item) => expected.includes(item)).length;
  const isCorrect = submitted.length === expected.length && correctCount === expected.length;
  const partialScore = hasWrong ? 0 : Math.round((question.score * correctCount) / expected.length);

  return {
    score: isCorrect ? question.score : partialScore,
    isCorrect,
    expectedAnswer: expected,
  };
}

function scoreText(question, answer) {
  const submitted = normalizeAnswer(answer);
  const expected = normalizeAnswer(question.answer);
  const correct = submitted === expected;
  return {
    score: correct ? question.score : 0,
    isCorrect: correct,
    expectedAnswer: "A → C → B → D → E → F",
  };
}

function gradeObjectiveQuestions(payload, answerKey = {}) {
  const answers = payload.answers || {};
  const details = Object.entries(answerKey).map(([id, question], index) => {
    const submittedAnswer = answers[id] ?? (question.type === "multiple" ? [] : "");
    const result = question.type === "text" ? scoreText(question, submittedAnswer) : scoreChoice(question, submittedAnswer);
    return {
      id,
      no: index + 1,
      title: question.title,
      type: question.type,
      score: result.score,
      maxScore: question.score,
      isCorrect: result.isCorrect,
      submittedAnswer,
      expectedAnswer: result.expectedAnswer,
    };
  });

  const objectiveScore = details.reduce((sum, item) => sum + item.score, 0);
  const objectiveMaxScore = details.reduce((sum, item) => sum + item.maxScore, 0);
  const startedAt = payload.startedAt || payload.candidate?.loginAt || payload.submittedAt;
  const submittedAt = payload.submittedAt || new Date().toISOString();
  const elapsedSeconds = startedAt ? Math.max(0, Math.round((new Date(submittedAt) - new Date(startedAt)) / 1000)) : null;

  return {
    objectiveScore,
    objectiveMaxScore,
    elapsedSeconds,
    details,
  };
}

function buildBaseCodeMeta(answers, codeProblemMeta = {}) {
  const codeAnswer = String(answers.codeAnswer || "").trim();
  return {
    problemId: answers.codeProblem || "",
    problemTitle: codeProblemMeta[answers.codeProblem] || answers.codeProblem || "",
    language: answers.codeLanguage || "Python",
    hasAnswer: Boolean(codeAnswer),
    answerLength: codeAnswer.length,
    reviewStatus: codeAnswer ? "待自动评分" : "未作答",
    reviewNote: "",
    reviewedAt: "",
    autoGraded: false,
    autoGradedAt: "",
    manualOverride: false,
    passedTests: 0,
    totalTests: 0,
    testResults: [],
  };
}

function scaleScoreToMax(score, fromMax, toMax) {
  if (score === null || score === undefined || score === "") return score;
  const numeric = Number(score);
  if (!Number.isFinite(numeric)) return score;
  if (!fromMax || fromMax === toMax) return Math.max(0, Math.min(toMax, Math.round(numeric)));
  return Math.max(0, Math.min(toMax, Math.round((numeric * toMax) / fromMax)));
}

function submissionNeedsGradeRefresh(submission, paper) {
  if (!submission?.grade || !paper) return false;
  const expectedMax = examStore.getPaperMaxScore(paper);
  if (!expectedMax) return false;
  return submission.grade.maxScore !== expectedMax;
}

async function refreshSubmissionGrade(submission) {
  const paper = resolveSubmissionPaper(submission);
  if (!paper?.answerKey) return submission;

  const prevGrade = submission.grade || {};
  const prevCodeMax = prevGrade.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE;
  const codeMaxScore = examStore.getCodeMaxScore(paper);
  const objective = gradeObjectiveQuestions(submission, paper.answerKey);
  const answers = submission.answers || {};
  const prevCode = prevGrade.code || {};
  let codeScore = prevGrade.codeScore;
  let nextCode = { ...prevCode };

  if (prevCode.hasAnswer && prevCode.autoGraded) {
    const autoResult = await autoGradeCodeSubmission({
      code: answers.codeAnswer,
      language: answers.codeLanguage || "Python",
      problemId: answers.codeProblem || "",
      codeMaxScore,
      codeProblemTests: paper.codeProblemTests || {},
    });
    codeScore = autoResult.codeScore;
    nextCode = { ...nextCode, ...autoResult.codeMeta };
  } else if (codeScore !== null && codeScore !== undefined && prevCodeMax !== codeMaxScore) {
    codeScore = scaleScoreToMax(codeScore, prevCodeMax, codeMaxScore);
  }

  submission.grade = {
    ...prevGrade,
    objectiveScore: objective.objectiveScore,
    objectiveMaxScore: objective.objectiveMaxScore,
    details: objective.details,
    elapsedSeconds: objective.elapsedSeconds ?? prevGrade.elapsedSeconds,
    codeMaxScore,
    codeScore,
    code: nextCode,
    maxScore: objective.objectiveMaxScore + codeMaxScore,
    score: (objective.objectiveScore || 0) + (codeScore || 0),
    manualReviewRequired: codeScore === null && nextCode.hasAnswer,
  };
  return submission;
}

async function migrateSubmissionGradesToCurrentPaper() {
  await withFileLock(submissionsFile, async () => {
    const submissions = readSubmissions();
    let updatedCount = 0;
    const next = [];

    for (const submission of submissions) {
      const paper = resolveSubmissionPaper(submission);
      if (submissionNeedsGradeRefresh(submission, paper)) {
        next.push(await refreshSubmissionGrade({ ...submission }));
        updatedCount += 1;
      } else {
        next.push(submission);
      }
    }

    if (updatedCount > 0) {
      writeSubmissions(next);
      console.log(`[grade-migrate] 已将 ${updatedCount} 条提交记录更新为当前满分制`);
    }
  });
}

function gradeSubmission(payload, paper) {
  const answers = payload.answers || {};
  const answerKey = paper?.answerKey || {};
  const codeProblemMeta = examStore.getCodeProblemMeta(paper);
  const objective = gradeObjectiveQuestions(payload, answerKey);
  const codeMaxScore = examStore.getCodeMaxScore(paper);
  const codeAnswer = String(answers.codeAnswer || "").trim();

  return {
    score: objective.objectiveScore,
    maxScore: objective.objectiveMaxScore + codeMaxScore,
    objectiveScore: objective.objectiveScore,
    objectiveMaxScore: objective.objectiveMaxScore,
    codeScore: codeAnswer ? null : 0,
    codeMaxScore,
    manualReviewRequired: Boolean(codeAnswer),
    elapsedSeconds: objective.elapsedSeconds,
    details: objective.details,
    code: buildBaseCodeMeta(answers, codeProblemMeta),
  };
}

function normalizeCodeScore(value, maxScore = examStore.DEFAULT_CODE_MAX_SCORE) {
  if (value === null || value === undefined || value === "") return null;
  const score = Number(value);
  if (!Number.isFinite(score)) return null;
  return Math.max(0, Math.min(maxScore, Math.round(score)));
}

function applyCodeGrade(submission, payload = {}) {
  const paper = resolveSubmissionPaper(submission);
  const grade = submission.grade || gradeSubmission(submission, paper);
  const codeMaxScore = grade.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE;
  const codeScore = normalizeCodeScore(payload.codeScore, codeMaxScore);
  const reviewStatus = String(payload.reviewStatus || "").trim() || (codeScore === null ? "待人工复核" : "已评分");
  const reviewNote = String(payload.reviewNote || "").trim();

  grade.codeScore = codeScore;
  grade.code = {
    ...(grade.code || {}),
    reviewStatus,
    reviewNote,
    reviewedAt: codeScore === null ? "" : new Date().toISOString(),
    manualOverride: true,
  };
  grade.score = (grade.objectiveScore || 0) + (codeScore || 0);
  grade.manualReviewRequired = codeScore === null && grade.code?.hasAnswer;
  submission.grade = grade;
  return submission;
}

function notifySubmissionReceived(submission) {
  const name = submission.candidate?.name || "未知考生";
  const role = submission.candidate?.role || "-";
  const contact = submission.candidate?.contact || "-";
  const grade = submission.grade || {};
  const title = "有新的试卷提交";
  const message = `${name}（${role}）已提交试卷，总分 ${grade.score ?? "-"} / ${grade.maxScore ?? "-"}`;

  console.log(`[提交提醒] ${name} / ${contact} / ${role}`);

  if (!notifyOnSubmit) return;

  const script = `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`;
  require("child_process").execFile("osascript", ["-e", script], () => {});
}

function truncateOutput(text) {
  const value = String(text || "");
  if (value.length <= MAX_OUTPUT_LENGTH) return value;
  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n...[输出已截断]`;
}

function createRunDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "exam-run-"));
}

function cleanupRunDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch (error) {
    // ignore cleanup errors
  }
}

function runProcess(command, args, { cwd, input = "" }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer = setTimeout(() => {
      killed = true;
      child.kill("SIGKILL");
      reject(new Error("运行超时（8 秒），请检查是否存在死循环。"));
    }, RUN_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > MAX_OUTPUT_LENGTH * 2) stdout = stdout.slice(0, MAX_OUTPUT_LENGTH * 2);
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > MAX_OUTPUT_LENGTH * 2) stderr = stderr.slice(0, MAX_OUTPUT_LENGTH * 2);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      if (killed) return;
      resolve({
        stdout: truncateOutput(stdout),
        stderr: truncateOutput(stderr),
        exitCode,
      });
    });

    child.stdin.write(String(input || ""));
    child.stdin.end();
  });
}

async function compileAndRun(language, code, input) {
  const workDir = createRunDir();
  const startedAt = Date.now();

  try {
    if (language === "Python") {
      fs.writeFileSync(path.join(workDir, "main.py"), code, "utf8");
      const result = await runProcess("python3", ["main.py"], { cwd: workDir, input });
      return { ...result, durationMs: Date.now() - startedAt };
    }

    if (language === "C++") {
      fs.writeFileSync(path.join(workDir, "main.cpp"), code, "utf8");
      await execFile("g++", ["-std=c++17", "-O2", "-o", "main", "main.cpp"], {
        cwd: workDir,
        timeout: RUN_TIMEOUT_MS,
      });
      const result = await runProcess(path.join(workDir, "main"), [], { cwd: workDir, input });
      return { ...result, durationMs: Date.now() - startedAt };
    }

    if (language === "Java") {
      const classMatch = code.match(/public\s+class\s+([A-Za-z_]\w*)/);
      const className = classMatch ? classMatch[1] : "Main";
      fs.writeFileSync(path.join(workDir, `${className}.java`), code, "utf8");
      await execFile("javac", [`${className}.java`], { cwd: workDir, timeout: RUN_TIMEOUT_MS });
      const result = await runProcess("java", [className], { cwd: workDir, input });
      return { ...result, durationMs: Date.now() - startedAt };
    }

    throw new Error("暂不支持该语言的本地运行。");
  } catch (error) {
    const stdout = truncateOutput(error.stdout?.toString?.() || "");
    const stderr = truncateOutput(error.stderr?.toString?.() || error.message || "");
    if (stdout || stderr) {
      return {
        stdout,
        stderr,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
      };
    }
    throw error;
  } finally {
    cleanupRunDir(workDir);
  }
}

function normalizeJudgeOutput(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function outputsMatch(actual, expected) {
  return normalizeJudgeOutput(actual) === normalizeJudgeOutput(expected);
}

function prepareCodeForRun(language, code) {
  if (language !== "Python") return code;

  const trimmed = code.trim();
  const fnMatch = trimmed.match(/^def\s+(test|main|solve)\s*\(/m);
  if (!fnMatch) return code;

  const fnName = fnMatch[1];
  if (new RegExp(`\\b${fnName}\\s*\\(\\s*\\)`).test(trimmed)) return code;
  return `${trimmed}\n\n${fnName}()\n`;
}

function buildAutoReviewStatus(passedTests, totalTests) {
  if (totalTests === 0) return "待人工复核";
  if (passedTests === totalTests) return "通过";
  if (passedTests > 0) return "部分通过";
  return "未通过";
}

function buildAutoReviewNote(testResults) {
  const lines = testResults.map((item) => {
    const mark = item.passed ? "✓" : "✗";
    return `${mark} ${item.name}${item.passed ? "" : `（期望 ${item.expectedOutput}，实际 ${item.actualOutput || "无输出"}）`}`;
  });
  return `自动评测：${lines.join("；")}`;
}

async function autoGradeCodeSubmission({ code, language, problemId, codeMaxScore = examStore.DEFAULT_CODE_MAX_SCORE, codeProblemTests = {} }) {
  const trimmedCode = String(code || "").trim();
  const tests = codeProblemTests[problemId] || [];
  const preparedCode = prepareCodeForRun(language, trimmedCode);

  if (!trimmedCode) {
    return {
      codeScore: 0,
      manualReviewRequired: false,
      codeMeta: {
        reviewStatus: "未作答",
        reviewNote: "未提交代码。",
        autoGraded: true,
        autoGradedAt: new Date().toISOString(),
        manualOverride: false,
        passedTests: 0,
        totalTests: tests.length,
        testResults: [],
      },
    };
  }

  if (!ENABLE_CODE_RUNNER) {
    return {
      codeScore: null,
      manualReviewRequired: true,
      codeMeta: {
        reviewStatus: "待人工复核",
        reviewNote: "代码运行器未启用，请人工复核。",
        autoGraded: false,
        autoGradedAt: "",
        manualOverride: false,
        passedTests: 0,
        totalTests: tests.length,
        testResults: [],
      },
    };
  }

  if (!tests.length) {
    return {
      codeScore: null,
      manualReviewRequired: true,
      codeMeta: {
        reviewStatus: "待人工复核",
        reviewNote: "当前题目暂无自动评测用例，请人工复核。",
        autoGraded: false,
        autoGradedAt: "",
        manualOverride: false,
        passedTests: 0,
        totalTests: 0,
        testResults: [],
      },
    };
  }

  if (!allowedRunLanguages.includes(language)) {
    return {
      codeScore: null,
      manualReviewRequired: true,
      codeMeta: {
        reviewStatus: "待人工复核",
        reviewNote: `暂不支持 ${language} 的自动评测，请人工复核。`,
        autoGraded: false,
        autoGradedAt: "",
        manualOverride: false,
        passedTests: 0,
        totalTests: tests.length,
        testResults: [],
      },
    };
  }

  const testResults = [];
  for (const testCase of tests) {
    let runResult;
    try {
      runResult = await compileAndRun(language, preparedCode, testCase.input);
    } catch (error) {
      runResult = {
        stdout: "",
        stderr: error.message || "运行失败",
        exitCode: 1,
      };
    }

    const actualOutput = normalizeJudgeOutput(runResult.stdout);
    const expectedOutput = normalizeJudgeOutput(testCase.output);
    const passed = runResult.exitCode === 0 && outputsMatch(actualOutput, expectedOutput);

    testResults.push({
      name: testCase.name,
      passed,
      expectedOutput: testCase.output.trim(),
      actualOutput: actualOutput || (runResult.stderr ? "" : "(无输出)"),
      exitCode: runResult.exitCode,
      error: passed ? "" : runResult.stderr || (runResult.exitCode !== 0 ? `退出码 ${runResult.exitCode}` : "输出不匹配"),
    });
  }

  const passedTests = testResults.filter((item) => item.passed).length;
  const totalTests = testResults.length;
  const codeScore = Math.round((codeMaxScore * passedTests) / totalTests);
  const reviewStatus = buildAutoReviewStatus(passedTests, totalTests);

  return {
    codeScore,
    manualReviewRequired: false,
    codeMeta: {
      reviewStatus,
      reviewNote: buildAutoReviewNote(testResults),
      reviewedAt: new Date().toISOString(),
      autoGraded: true,
      autoGradedAt: new Date().toISOString(),
      manualOverride: false,
      passedTests,
      totalTests,
      testResults,
    },
  };
}

async function completeSubmissionGrade(payload) {
  const paper = resolveSubmissionPaper(payload);
  const answers = payload.answers || {};
  const grade = gradeSubmission(payload, paper);
  const codeMaxScore = grade.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE;
  const autoResult = await autoGradeCodeSubmission({
    code: answers.codeAnswer,
    language: answers.codeLanguage || "Python",
    problemId: answers.codeProblem || "",
    codeMaxScore,
    codeProblemTests: paper?.codeProblemTests || {},
  });

  grade.codeScore = autoResult.codeScore;
  grade.code = {
    ...grade.code,
    ...autoResult.codeMeta,
  };
  grade.score = (grade.objectiveScore || 0) + (autoResult.codeScore || 0);
  grade.manualReviewRequired = autoResult.manualReviewRequired;
  return grade;
}

async function applyAutoGradeToSubmission(submission) {
  const paper = resolveSubmissionPaper(submission);
  const answers = submission.answers || {};
  const grade = submission.grade || gradeSubmission(submission, paper);
  const autoResult = await autoGradeCodeSubmission({
    code: answers.codeAnswer,
    language: answers.codeLanguage || "Python",
    problemId: answers.codeProblem || "",
    codeMaxScore: grade.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE,
    codeProblemTests: paper?.codeProblemTests || {},
  });

  grade.codeScore = autoResult.codeScore;
  grade.code = {
    ...grade.code,
    ...autoResult.codeMeta,
    manualOverride: false,
  };
  grade.score = (grade.objectiveScore || 0) + (autoResult.codeScore || 0);
  grade.manualReviewRequired = autoResult.manualReviewRequired;
  submission.grade = grade;
  return submission;
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/jobs") {
    sendJson(response, 200, { jobs });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/session") {
    const session = getAdminSession(request);
    if (!session) {
      sendJson(response, 401, { ok: false, message: "未登录后台。" });
      return true;
    }
    sendJson(response, 200, { ok: true, role: session.role });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/login") {
    if (!checkAdminLoginRateLimit(request)) {
      sendJson(response, 429, { ok: false, message: "登录尝试过多，请 15 分钟后再试。" });
      return true;
    }

    const body = await readRequestBody(request);
    const password = String(body.password || "");
    const role = resolveAdminRoleFromPassword(password);
    if (!role) {
      recordAdminLoginFailure(request);
      sendJson(response, 403, { ok: false, message: "后台密码错误。" });
      return true;
    }

    clearAdminLoginFailures(request);
    const token = generateToken();
    adminSessions.set(token, {
      expiresAt: Date.now() + ADMIN_SESSION_MAX_AGE_SECONDS * 1000,
      role,
    });
    setAdminSessionCookie(response, token, request);
    sendJson(response, 200, { ok: true, role });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/admin/logout") {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[ADMIN_COOKIE_NAME];
    if (token) adminSessions.delete(token);
    clearAdminSessionCookie(response, request);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/exam/session") {
    const session = getExamSession(request);
    if (!session) {
      sendJson(response, 401, { ok: false, message: "未登录或登录已失效。" });
      return true;
    }
    sendJson(response, 200, {
      ok: true,
      session: publicExamSession(session),
      alreadySubmitted: hasSubmitted(session.phone, session.job),
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/exam/logout") {
    const cookies = parseCookies(request.headers.cookie);
    const token = cookies[EXAM_COOKIE_NAME];
    if (token) examSessions.delete(token);
    clearExamSessionCookie(response, request);
    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/exam/anticheat-config") {
    const session = getExamSession(request);
    if (!session) {
      sendJson(response, 401, { ok: false, message: "未登录或登录已失效。" });
      return true;
    }
    sendJson(response, 200, {
      ok: true,
      config: publicExamSession(session).antiCheat,
    });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/exam/integrity") {
    const session = requireExamSession(request, response);
    if (!session) return true;

    const body = await readRequestBody(request);
    const merged = mergeExamIntegrity(session, body);
    examSessions.set(session.token, {
      ...examSessions.get(session.token),
      integrity: merged,
    });
    sendJson(response, 200, { ok: true, integrity: merged });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/login") {
    const body = await readRequestBody(request);
    const username = String(body.username || "").trim();
    const phone = normalizePhone(body.phone);
    const job = normalizeJob(body.job);

    if (!username || !phone || !job) {
      sendJson(response, 400, { ok: false, message: "请填写姓名、手机号和岗位。" });
      return true;
    }

    if (!jobs.includes(job)) {
      sendJson(response, 400, { ok: false, message: "岗位不在可选范围内。" });
      return true;
    }

    if (!isAdminTestPhone(phone) && !isValidCandidatePhone(phone)) {
      sendJson(response, 400, { ok: false, message: "请填写有效的 11 位手机号。" });
      return true;
    }

    if (!isPhoneAllowed(phone, job)) {
      sendJson(response, 403, { ok: false, message: LOGIN_DENIED_MESSAGE });
      return true;
    }

    const paper = examStore.getActiveExamPaper(job);
    if (!paper) {
      sendJson(response, 403, { ok: false, message: "该岗位尚未配置试卷，请联系管理员。" });
      return true;
    }

    if (hasSubmitted(phone, job)) {
      sendJson(response, 403, { ok: false, message: LOGIN_DENIED_MESSAGE });
      return true;
    }

    const loginAt = new Date().toISOString();
    const durationSeconds = (paper.durationMinutes || 40) * 60;
    const token = generateToken();
    examSessions.set(token, {
      username,
      phone,
      job,
      examId: paper.id,
      durationSeconds,
      loginAt,
      startedAt: loginAt,
      expiresAt: Date.now() + EXAM_SESSION_MAX_AGE_SECONDS * 1000,
      integrity: {
        violationCount: 0,
        events: [],
        counts: {},
        forcedSubmit: false,
      },
    });
    setExamSessionCookie(response, token, request);
    sendJson(response, 200, {
      ok: true,
      session: publicExamSession(examSessions.get(token)),
    });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/exams/active") {
    const session = requireExamSession(request, response);
    if (!session) return true;

    const requestedJob = normalizeJob(url.searchParams.get("job"));
    if (requestedJob && requestedJob !== session.job) {
      sendJson(response, 403, { ok: false, message: "无权访问该岗位试卷。" });
      return true;
    }

    const paper = resolveSessionPaper(session);
    if (!paper) {
      sendJson(response, 404, { ok: false, message: "该岗位尚未配置试卷。" });
      return true;
    }
    sendJson(response, 200, { ok: true, paper: examStore.stripPaperForClient(paper) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/exams") {
    if (!requireAdmin(request, response, "tech")) return true;
    sendJson(response, 200, { ok: true, exams: examStore.listAdminExamSummary(jobs) });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/exams/import") {
    if (!requireAdmin(request, response, "tech")) return true;
    try {
      const { fields, file } = await readMultipartRequest(request);
      const job = normalizeJob(fields.job);
      const durationMinutes = Number(fields.durationMinutes) || 40;
      const title = String(fields.title || "").trim();
      const text = await extractTextFromUpload(file);
      const parsed = await parseUploadedExamText(text);
      if (!parsed.paper) {
        sendJson(response, 400, { ok: false, message: parsed.errors.join(" ") || "解析失败。" });
        return true;
      }
      if (title) parsed.paper.title = title;
      parsed.paper.durationMinutes = durationMinutes;
      parsed.paper.job = job;
      const draft = examStore.saveImportDraft({
        job,
        durationMinutes,
        parseMethod: parsed.parseMethod,
        warnings: parsed.errors,
        paper: parsed.paper,
      });
      sendJson(response, 200, {
        ok: parsed.ok,
        draftId: draft.id,
        warnings: parsed.errors,
        paper: examStore.stripPaperForClient(parsed.paper),
        parseMethod: parsed.parseMethod,
      });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message || "导入失败。" });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/exams/import/")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const draftId = decodeURIComponent(url.pathname.replace("/api/exams/import/", ""));
    const draft = examStore.readImportDraft(draftId);
    if (!draft) {
      sendJson(response, 404, { ok: false, message: "草稿不存在或已过期。" });
      return true;
    }
    sendJson(response, 200, {
      ok: true,
      draft: {
        id: draft.id,
        job: draft.job,
        durationMinutes: draft.durationMinutes,
        warnings: draft.warnings || [],
        parseMethod: draft.parseMethod,
        paper: examStore.stripPaperForClient(draft.paper),
      },
    });
    return true;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/exams/import/")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const draftId = decodeURIComponent(url.pathname.replace("/api/exams/import/", ""));
    const body = await readRequestBody(request);
    const draft = examStore.readImportDraft(draftId);
    if (!draft) {
      sendJson(response, 404, { ok: false, message: "草稿不存在或已过期。" });
      return true;
    }
    const nextPaper = body.paper ? { ...draft.paper, ...body.paper } : draft.paper;
    const updated = examStore.updateImportDraft(draftId, {
      job: body.job || draft.job,
      durationMinutes: body.durationMinutes || draft.durationMinutes,
      paper: nextPaper,
    });
    sendJson(response, 200, { ok: true, draft: { ...updated, paper: examStore.stripPaperForClient(updated.paper) } });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/exams/publish") {
    if (!requireAdmin(request, response, "tech")) return true;
    const body = await readRequestBody(request);
    const draftId = String(body.draftId || "");
    const job = normalizeJob(body.job);
    if (!draftId || !job) {
      sendJson(response, 400, { ok: false, message: "请提供草稿 ID 和岗位。" });
      return true;
    }
    const draft = examStore.readImportDraft(draftId);
    if (!draft?.paper) {
      sendJson(response, 404, { ok: false, message: "草稿不存在。" });
      return true;
    }
    const paper = await withFileLock(examsFile, async () =>
      examStore.publishExamPaper(job, {
        ...draft.paper,
        durationMinutes: draft.durationMinutes || draft.paper.durationMinutes || 40,
        job,
      })
    );
    examStore.deleteImportDraft(draftId);
    sendJson(response, 200, { ok: true, paper: examStore.stripPaperForClient(paper) });
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/exams/paper") {
    if (!requireAdmin(request, response, "tech")) return true;
    const job = normalizeJob(url.searchParams.get("job"));
    if (!job || !jobs.includes(job)) {
      sendJson(response, 400, { ok: false, message: "请指定有效岗位。" });
      return true;
    }
    const { examId, paper } = examStore.getAdminExamPaper(job);
    if (!paper) {
      sendJson(response, 404, { ok: false, message: "该岗位尚未配置试卷。" });
      return true;
    }
    sendJson(response, 200, { ok: true, examId, paper });
    return true;
  }

  if (request.method === "PATCH" && url.pathname === "/api/admin/exams/paper") {
    if (!requireAdmin(request, response, "tech")) return true;
    const body = await readRequestBody(request);
    const job = normalizeJob(body.job);
    const examId = String(body.examId || "");
    const changes = Array.isArray(body.changes) ? body.changes : [];
    if (!job || !examId || !changes.length) {
      sendJson(response, 400, { ok: false, message: "请提供岗位、试卷 ID 和修改内容。" });
      return true;
    }
    try {
      const paper = await withFileLock(examsFile, async () =>
        examStore.updateExamPaperContent(job, examId, changes)
      );
      sendJson(response, 200, { ok: true, examId, paper: examStore.stripPaperForClient(paper) });
    } catch (error) {
      sendJson(response, 400, { ok: false, message: error.message || "保存失败。" });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/admin/exams/export.pdf") {
    if (!requireAdmin(request, response, "tech")) return true;
    const job = normalizeJob(url.searchParams.get("job"));
    if (!job || !jobs.includes(job)) {
      sendJson(response, 400, { ok: false, message: "请指定有效岗位。" });
      return true;
    }
    const { paper } = examStore.getAdminExamPaper(job);
    if (!paper) {
      sendJson(response, 404, { ok: false, message: "该岗位尚未配置试卷。" });
      return true;
    }
    try {
      const publicPaper = examStore.stripPaperForClient(paper);
      const buffer = await generateExamPdfBuffer(publicPaper);
      const filename = encodeURIComponent(buildExamExportFilename(publicPaper));
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store",
      });
      response.end(buffer);
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message || "PDF 生成失败。" });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/candidates") {
    if (!requireAdmin(request, response)) return true;
    sendJson(response, 200, { candidates: getCandidatesForAdmin() });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/run-code") {
    const session = requireExamSession(request, response);
    if (!session) return true;

    if (!ENABLE_CODE_RUNNER) {
      sendJson(response, 403, { ok: false, message: "代码运行器未启用，当前环境不支持在线运行代码。" });
      return true;
    }

    if (!checkRunCodeRateLimit(session.token)) {
      sendJson(response, 429, { ok: false, message: "运行过于频繁，请稍后再试。" });
      return true;
    }

    const body = await readRequestBody(request);
    const code = String(body.code || "");
    const language = String(body.language || "Python");
    const input = String(body.input || "");

    if (!code.trim()) {
      sendJson(response, 400, { ok: false, message: "请先编写代码。" });
      return true;
    }

    if (code.length > MAX_CODE_LENGTH) {
      sendJson(response, 400, { ok: false, message: "代码过长，无法运行。" });
      return true;
    }

    if (input.length > MAX_INPUT_LENGTH) {
      sendJson(response, 400, { ok: false, message: "测试输入过长，无法运行。" });
      return true;
    }

    if (!allowedRunLanguages.includes(language)) {
      sendJson(response, 400, { ok: false, message: "暂不支持该语言的本地运行。" });
      return true;
    }

    try {
      const result = await compileAndRun(language, code, input);
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        message: error.message || "代码运行失败。",
        stdout: "",
        stderr: "",
        exitCode: 1,
      });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/submissions") {
    if (!requireAdmin(request, response, "tech")) return true;
    sendJson(response, 200, { submissions: readSubmissions() });
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/submissions/")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/submissions/", "").replace(/\/+$/, ""));
    if (!id || id.includes("/")) {
      sendJson(response, 400, { ok: false, message: "无效的提交记录 ID。" });
      return true;
    }

    try {
      await withFileLock(submissionsFile, async () => {
        const submissions = readSubmissions();
        const nextSubmissions = submissions.filter((item) => item.id !== id);
        if (nextSubmissions.length === submissions.length) {
          throw new Error("SUBMISSION_NOT_FOUND");
        }
        writeSubmissions(nextSubmissions);
      });
    } catch (error) {
      if (error.message === "SUBMISSION_NOT_FOUND") {
        sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
        return true;
      }
      throw error;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  if (request.method === "GET" && url.pathname.match(/^\/api\/submissions\/[^/]+\/export\.pdf$/)) {
    if (!requireAdmin(request, response, "tech")) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/submissions/", "").replace(/\/export\.pdf$/, ""));
    const submission = readSubmissions().find((item) => item.id === id);
    if (!submission) {
      sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
      return true;
    }
    try {
      const buffer = await generateSubmissionPdfBuffer(submission);
      const filename = encodeURIComponent(buildSubmissionExportFilename(submission));
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "no-store",
      });
      response.end(buffer);
    } catch (error) {
      sendJson(response, 500, { ok: false, message: error.message || "PDF 生成失败。" });
    }
    return true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/submissions/")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/submissions/", ""));
    if (id.includes("/")) return false;
    const submission = readSubmissions().find((item) => item.id === id);
    if (!submission) {
      sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
      return true;
    }
    sendJson(response, 200, { submission });
    return true;
  }

  if (request.method === "PATCH" && url.pathname.startsWith("/api/submissions/") && url.pathname.endsWith("/code-grade")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/submissions/", "").replace(/\/code-grade$/, ""));
    const preview = readSubmissions().find((item) => item.id === id);
    if (!preview) {
      sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
      return true;
    }

    const body = await readRequestBody(request);
    const codeScore = normalizeCodeScore(body.codeScore, preview.grade?.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE);
    if (codeScore === null) {
      const max = preview.grade?.codeMaxScore || examStore.DEFAULT_CODE_MAX_SCORE;
      sendJson(response, 400, { ok: false, message: `请填写 0 到 ${max} 之间的代码题得分。` });
      return true;
    }

    let updatedSubmission;
    try {
      await withFileLock(submissionsFile, async () => {
        const lockedSubmissions = readSubmissions();
        const lockedIndex = lockedSubmissions.findIndex((item) => item.id === id);
        if (lockedIndex < 0) {
          throw new Error("SUBMISSION_NOT_FOUND");
        }
        updatedSubmission = applyCodeGrade(lockedSubmissions[lockedIndex], body);
        lockedSubmissions[lockedIndex] = updatedSubmission;
        writeSubmissions(lockedSubmissions);
      });
    } catch (error) {
      if (error.message === "SUBMISSION_NOT_FOUND") {
        sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
        return true;
      }
      throw error;
    }

    sendJson(response, 200, { ok: true, submission: updatedSubmission });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/submissions") {
    const session = requireExamSession(request, response);
    if (!session) return true;

    if (hasSubmitted(session.phone, session.job)) {
      sendJson(response, 409, { ok: false, message: "该手机号和岗位已提交过试卷，不能重复提交。" });
      return true;
    }

    const elapsedSeconds = Math.floor((Date.now() - new Date(session.startedAt).getTime()) / 1000);
    const maxSubmitSeconds = (session.durationSeconds || EXAM_DURATION_SECONDS) + EXAM_SUBMIT_GRACE_SECONDS;
    if (elapsedSeconds > maxSubmitSeconds) {
      sendJson(response, 403, { ok: false, message: "答题时间已结束，无法提交试卷。" });
      return true;
    }

    const body = await readRequestBody(request);
    if (!body.answers) {
      sendJson(response, 400, { ok: false, message: "试卷信息不完整，提交失败。" });
      return true;
    }
    const candidateName = String(body.candidateName || session.username || "").trim();
    if (!candidateName) {
      sendJson(response, 400, { ok: false, message: "请填写姓名。" });
      return true;
    }
    const liveSession = examSessions.get(session.token) || session;

    const paper = resolveSessionPaper(session);
    const submittedAt = new Date().toISOString();
    const submission = {
      id: `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`,
      examId: session.examId || paper?.id || null,
      examTitle: body.examTitle || paper?.title || "技术测验",
      source: body.source || paper?.source || "",
      submittedAt,
      startedAt: session.startedAt,
      candidate: {
        name: candidateName,
        contact: session.phone,
        role: session.job,
      },
      answers: body.answers,
      integrity: liveSession.integrity || null,
    };
    submission.grade = await completeSubmissionGrade(submission);

    try {
      await withFileLock(submissionsFile, async () => {
        if (hasSubmitted(session.phone, session.job)) {
          throw new Error("ALREADY_SUBMITTED");
        }
        const submissions = readSubmissions();
        submissions.unshift(submission);
        writeSubmissions(submissions);
      });
    } catch (error) {
      if (error.message === "ALREADY_SUBMITTED") {
        sendJson(response, 409, { ok: false, message: "该手机号和岗位已提交过试卷，不能重复提交。" });
        return true;
      }
      throw error;
    }

    examSessions.delete(session.token);
    clearExamSessionCookie(response, request);
    notifySubmissionReceived(submission);
    sendJson(response, 200, publicSubmissionResult(submission));
    return true;
  }

  if (request.method === "POST" && url.pathname.startsWith("/api/submissions/") && url.pathname.endsWith("/auto-grade-code")) {
    if (!requireAdmin(request, response, "tech")) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/submissions/", "").replace(/\/auto-grade-code$/, ""));

    let updatedSubmission;
    try {
      await withFileLock(submissionsFile, async () => {
        const submissions = readSubmissions();
        const index = submissions.findIndex((item) => item.id === id);
        if (index < 0) {
          throw new Error("SUBMISSION_NOT_FOUND");
        }
        updatedSubmission = await applyAutoGradeToSubmission({ ...submissions[index] });
        submissions[index] = updatedSubmission;
        writeSubmissions(submissions);
      });
    } catch (error) {
      if (error.message === "SUBMISSION_NOT_FOUND") {
        sendJson(response, 404, { ok: false, message: "没有找到该试卷。" });
        return true;
      }
      throw error;
    }

    sendJson(response, 200, { ok: true, submission: updatedSubmission });
    return true;
  }

  if (request.method === "POST" && url.pathname === "/api/candidates") {
    if (!requireAdmin(request, response)) return true;
    const body = await readRequestBody(request);
    const phone = normalizePhone(body.phone);
    const job = normalizeJob(body.job);
    const applyDate = normalizeApplyDate(body.applyDate);

    if (!phone || !job || !applyDate) {
      sendJson(response, 400, { ok: false, message: "请填写手机号、岗位和应聘时间（月/日/时）。" });
      return true;
    }

    if (phone === "123") {
      sendJson(response, 400, { ok: false, message: "123 是管理员测试号，不需要录入。" });
      return true;
    }

    if (!isValidCandidatePhone(phone)) {
      sendJson(response, 400, { ok: false, message: "请输入有效的中国大陆手机号（11 位数字）。" });
      return true;
    }

    if (!jobs.includes(job)) {
      sendJson(response, 400, { ok: false, message: "岗位不在可选范围内。" });
      return true;
    }

    const candidate = {
      id: `${Date.now()}-${crypto.randomBytes(8).toString("hex")}`,
      phone,
      job,
      applyDate,
      createdAt: new Date().toISOString(),
    };

    try {
      await withFileLock(candidatesFile, async () => {
        const candidates = readCandidates();
        const key = candidateKey(phone, job);
        const exists = candidates.some((item) => candidateKey(item.phone, item.job) === key);
        if (exists) {
          throw new Error("CANDIDATE_EXISTS");
        }
        candidates.unshift(candidate);
        writeCandidates(candidates);
      });
    } catch (error) {
      if (error.message === "CANDIDATE_EXISTS") {
        sendJson(response, 409, { ok: false, message: "该手机号和岗位已经录入。" });
        return true;
      }
      throw error;
    }

    sendJson(response, 201, { ok: true, candidate });
    return true;
  }

  if (request.method === "DELETE" && url.pathname.startsWith("/api/candidates/")) {
    if (!requireAdmin(request, response)) return true;
    const id = decodeURIComponent(url.pathname.replace("/api/candidates/", ""));

    try {
      await withFileLock(candidatesFile, async () => {
        const candidates = readCandidates();
        const nextCandidates = candidates.filter((candidate) => candidate.id !== id);
        if (nextCandidates.length === candidates.length) {
          throw new Error("CANDIDATE_NOT_FOUND");
        }
        writeCandidates(nextCandidates);
      });
    } catch (error) {
      if (error.message === "CANDIDATE_NOT_FOUND") {
        sendJson(response, 404, { ok: false, message: "没有找到该记录。" });
        return true;
      }
      throw error;
    }

    sendJson(response, 200, { ok: true });
    return true;
  }

  return false;
}

function isBlockedStaticPath(requestedPath) {
  const normalized = requestedPath.replace(/\\/g, "/");
  if (BLOCKED_STATIC_FILES.has(normalized)) return true;
  return BLOCKED_STATIC_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function serveStatic(request, response, url) {
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === "/" ? "/login.html" : pathname;

  if (isBlockedStaticPath(requestedPath)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  if (requestedPath === "/index.html" || requestedPath === "/app.js") {
    if (!getExamSession(request)) {
      response.writeHead(302, { Location: "/login.html" });
      response.end();
      return;
    }
  }

  const filePath = path.normalize(path.join(rootDir, requestedPath));

  if (requestedPath === "/admin.html" || requestedPath === "/admin.js" || requestedPath === "/admin-pdf-preview.html") {
    if (!isAdminAuthed(request)) {
      response.writeHead(302, { Location: "/login.html" });
      response.end();
      return;
    }
  }

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    response.writeHead(200, {
      "Content-Type": mimeTypes[ext] || "application/octet-stream",
      "Cache-Control": "no-store",
    });
    response.end(content);
  });
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(request, response, url);
      if (!handled) sendJson(response, 404, { ok: false, message: "接口不存在。" });
      return;
    }
    serveStatic(request, response, url);
  } catch (error) {
    console.error("[server-error]", error);
    sendJson(response, 500, { ok: false, message: "服务器错误，请稍后重试。" });
  }
});

function getLanAddresses() {
  const addresses = [];
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

server.listen(port, "0.0.0.0", () => {
  console.log(`Exam system is running at http://127.0.0.1:${port}`);
  for (const ip of getLanAddresses()) {
    console.log(`LAN access: http://${ip}:${port}`);
  }
  migrateSubmissionGradesToCurrentPaper().catch((error) => {
    console.error("[grade-migrate] 提交记录满分制迁移失败:", error.message);
  });
});
