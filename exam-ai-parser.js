const EXAM_PARSE_API_KEY = process.env.EXAM_PARSE_API_KEY || "";
const EXAM_PARSE_API_BASE = (process.env.EXAM_PARSE_API_BASE || "https://api.openai.com/v1").replace(/\/$/, "");
const EXAM_PARSE_MODEL = process.env.EXAM_PARSE_MODEL || "gpt-4o-mini";

const SCHEMA_HINT = `请把试卷文本解析为 JSON，且只输出 JSON，结构如下：
{
  "title": "试卷标题",
  "durationMinutes": 40,
  "sections": [
    {
      "id": "single",
      "number": "02",
      "title": "基础单选",
      "description": "每题只有一个正确答案。",
      "questions": [
        { "id": "single_1", "type": "single", "difficulty": "简单", "score": 4, "title": "题干", "options": ["选项1","选项2"] }
      ]
    }
  ],
  "codeProblems": [
    { "id": "code_1", "title": "题目A", "difficulty": "很难", "body": [["题目描述","..."]] }
  ],
  "answerKey": {
    "single_1": { "type": "single", "answer": "B", "score": 4, "title": "题干摘要" }
  },
  "codeProblemTests": {
    "code_1": [{ "name": "样例1", "input": "...", "output": "..." }]
  },
  "codeProblemMeta": { "code_1": "题目A" }
}`;

function extractJson(text) {
  const raw = String(text || "").trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(raw);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start < 0 || end < 0) throw new Error("模型未返回有效 JSON。");
  return JSON.parse(candidate.slice(start, end + 1));
}

async function parseExamWithAi(text) {
  if (!EXAM_PARSE_API_KEY) {
    return {
      ok: false,
      errors: ["未配置 EXAM_PARSE_API_KEY，无法使用智能解析。请按模板格式整理文档后重试。"],
      paper: null,
      parseMethod: "ai",
    };
  }

  const response = await fetch(`${EXAM_PARSE_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${EXAM_PARSE_API_KEY}`,
    },
    body: JSON.stringify({
      model: EXAM_PARSE_MODEL,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: "你是在线答题试卷结构化助手。把中文试卷文本转成严格 JSON，题型仅支持 single、multiple、text、代码题放入 codeProblems。",
        },
        {
          role: "user",
          content: `${SCHEMA_HINT}\n\n试卷原文：\n${String(text).slice(0, 120000)}`,
        },
      ],
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    return {
      ok: false,
      errors: [data.error?.message || "智能解析接口调用失败。"],
      paper: null,
      parseMethod: "ai",
    };
  }

  try {
    const paper = extractJson(data.choices?.[0]?.message?.content || "");
    if (!paper.sections) paper.sections = [];
    if (!paper.codeProblems) paper.codeProblems = [];
    if (!paper.answerKey) paper.answerKey = {};
    if (!paper.codeProblemTests) paper.codeProblemTests = {};
    if (!paper.codeProblemMeta) paper.codeProblemMeta = {};
    if (!paper.durationMinutes) paper.durationMinutes = 40;
    return { ok: true, errors: [], paper, parseMethod: "ai" };
  } catch (error) {
    return { ok: false, errors: [error.message || "智能解析结果无法读取。"], paper: null, parseMethod: "ai" };
  }
}

module.exports = { parseExamWithAi };
