const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const defaultExamPaper = require("./default-exam-paper");

const DEFAULT_CODE_MAX_SCORE = 30;

const dataDir = path.join(__dirname, "data");
const examsFile = path.join(dataDir, "exams.json");
const draftsDir = path.join(dataDir, "exam-drafts");

function ensureExamStore() {
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(draftsDir)) fs.mkdirSync(draftsDir, { recursive: true });
  if (!fs.existsSync(examsFile)) {
    const seed = {
      activeByJob: {
        大模型工程师: "default",
        游戏策划师: "default",
        全栈工程师: "default",
      },
      papers: {
        default: {
          ...defaultExamPaper,
          createdAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(examsFile, `${JSON.stringify(seed, null, 2)}\n`, "utf8");
  }
}

function readExamStore() {
  ensureExamStore();
  try {
    const parsed = JSON.parse(fs.readFileSync(examsFile, "utf8"));
    if (!parsed.activeByJob) parsed.activeByJob = {};
    if (!parsed.papers) parsed.papers = {};
    return parsed;
  } catch (error) {
    return { activeByJob: {}, papers: {} };
  }
}

function writeExamStore(store) {
  ensureExamStore();
  writeJsonAtomic(examsFile, store);
}

function writeJsonAtomic(filePath, value) {
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempFile, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempFile, filePath);
}

function isSafeDraftId(draftId) {
  return /^[A-Za-z0-9_-]+$/.test(String(draftId || ""));
}

function getDraftPath(draftId) {
  if (!isSafeDraftId(draftId)) return null;
  return path.join(draftsDir, `${draftId}.json`);
}

function getActiveExamId(job) {
  const store = readExamStore();
  return store.activeByJob[job] || null;
}

function getExamPaper(examId) {
  if (!examId) return null;
  const store = readExamStore();
  return store.papers[examId] || null;
}

function getActiveExamPaper(job) {
  const examId = getActiveExamId(job);
  return getExamPaper(examId);
}

function stripPaperForClient(paper) {
  if (!paper) return null;
  const { answerKey, codeProblemTests, codeProblemMeta, ...publicPaper } = paper;
  return publicPaper;
}

function getCodeProblemMeta(paper) {
  if (!paper) return {};
  if (paper.codeProblemMeta) return paper.codeProblemMeta;
  const meta = {};
  for (const problem of paper.codeProblems || []) {
    meta[problem.id] = problem.title;
  }
  return meta;
}

function getCodeMaxScore(paper) {
  const value = Number(paper?.codeMaxScore);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_CODE_MAX_SCORE;
}

function getPaperMaxScore(paper) {
  if (!paper) return null;
  const answerKey = paper.answerKey || {};
  const objectiveMaxScore = Object.values(answerKey).reduce(
    (sum, question) => sum + (Number(question?.score) || 0),
    0
  );
  return objectiveMaxScore + getCodeMaxScore(paper);
}

function listAdminExamSummary(jobs) {
  const store = readExamStore();
  return jobs.map((job) => {
    const examId = store.activeByJob[job];
    const paper = examId ? store.papers[examId] : null;
    return {
      job,
      examId: examId || null,
      title: paper?.title || "未配置",
      durationMinutes: paper?.durationMinutes || null,
      updatedAt: paper?.updatedAt || paper?.createdAt || null,
      questionCount: (paper?.sections || []).reduce((sum, s) => sum + (s.questions?.length || 0), 0),
      codeProblemCount: paper?.codeProblems?.length || 0,
    };
  });
}

function publishExamPaper(job, paperDraft) {
  const store = readExamStore();
  const examId = `exam-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const paper = {
    ...paperDraft,
    id: examId,
    job,
    createdAt: new Date().toISOString(),
  };
  store.papers[examId] = paper;
  store.activeByJob[job] = examId;
  writeExamStore(store);
  return paper;
}

function saveImportDraft(draft) {
  ensureExamStore();
  const draftId = draft.id || `draft-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const filePath = getDraftPath(draftId);
  if (!filePath) throw new Error("草稿 ID 不合法。");
  const payload = { ...draft, id: draftId, savedAt: new Date().toISOString() };
  writeJsonAtomic(filePath, payload);
  return payload;
}

function readImportDraft(draftId) {
  const filePath = getDraftPath(draftId);
  if (!filePath) return null;
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function updateImportDraft(draftId, updates) {
  const draft = readImportDraft(draftId);
  if (!draft) return null;
  const next = { ...draft, ...updates, id: draftId, savedAt: new Date().toISOString() };
  const filePath = getDraftPath(draftId);
  if (!filePath) return null;
  writeJsonAtomic(filePath, next);
  return next;
}

function deleteImportDraft(draftId) {
  const filePath = getDraftPath(draftId);
  if (!filePath) return;
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
}

function getAdminExamPaper(job) {
  const examId = getActiveExamId(job);
  if (!examId) return { examId: null, paper: null };
  return { examId, paper: getExamPaper(examId) };
}

function findQuestionInPaper(paper, questionId) {
  for (const section of paper?.sections || []) {
    const question = (section.questions || []).find((item) => item.id === questionId);
    if (question) return { section, question };
  }
  const codeProblem = (paper?.codeProblems || []).find((item) => item.id === questionId);
  if (codeProblem) return { section: null, question: codeProblem, isCode: true };
  return null;
}

function updateExamPaperContent(job, examId, changes = []) {
  const store = readExamStore();
  const activeId = store.activeByJob[job];
  if (!activeId || activeId !== examId) {
    throw new Error("试卷 ID 与岗位当前生效试卷不一致。");
  }
  const paper = store.papers[examId];
  if (!paper) throw new Error("试卷不存在。");

  for (const change of changes) {
    const questionId = String(change?.id || "").trim();
    if (!questionId) continue;
    const located = findQuestionInPaper(paper, questionId);
    if (!located) throw new Error(`未找到题目：${questionId}`);

    if (located.isCode) {
      if (change.title !== undefined) located.question.title = String(change.title);
      if (change.body !== undefined) located.question.body = change.body;
      continue;
    }

    if (change.title !== undefined) located.question.title = String(change.title);
    if (change.prompt !== undefined) located.question.prompt = String(change.prompt);
    if (change.options !== undefined) {
      if (!Array.isArray(change.options)) throw new Error(`题目 ${questionId} 选项格式错误。`);
      located.question.options = change.options.map((item) => String(item));
    }
  }

  paper.updatedAt = new Date().toISOString();
  store.papers[examId] = paper;
  writeExamStore(store);
  return paper;
}

module.exports = {
  examsFile,
  ensureExamStore,
  readExamStore,
  writeExamStore,
  getActiveExamId,
  getExamPaper,
  getActiveExamPaper,
  stripPaperForClient,
  getCodeProblemMeta,
  getCodeMaxScore,
  getPaperMaxScore,
  DEFAULT_CODE_MAX_SCORE,
  listAdminExamSummary,
  publishExamPaper,
  saveImportDraft,
  readImportDraft,
  updateImportDraft,
  deleteImportDraft,
  getAdminExamPaper,
  updateExamPaperContent,
};
