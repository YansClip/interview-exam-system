/**
 * 按 docs/exam-import-template.md 约定解析试卷纯文本
 */
function slugId(prefix, index) {
  return `${prefix}_${index}`;
}

function parseOptions(lines, startIndex) {
  const options = [];
  let i = startIndex;
  while (i < lines.length) {
    const match = /^([A-Z])[.、)\]]\s*(.+)$/.exec(lines[i].trim());
    if (!match) break;
    options.push(match[2].trim());
    i += 1;
  }
  return { options, nextIndex: i };
}

function parseAnswerLine(line) {
  const match = /^(?:答案|参考答案)\s*[:：]\s*(.+)$/i.exec(line.trim());
  if (!match) return null;
  const raw = match[1].trim();
  if (/^[A-Z](?:\s*[,，、]\s*[A-Z])+$/i.test(raw) || /^[A-Z]{2,}$/i.test(raw.replace(/\s/g, ""))) {
    return raw
      .toUpperCase()
      .replace(/，/g, ",")
      .split(/[,，、\s]+/)
      .filter(Boolean);
  }
  if (/^[A-Z]$/i.test(raw)) return raw.toUpperCase();
  return raw.replace(/\s+/g, "").toUpperCase();
}

function parseScoreLine(line, fallback = 5) {
  const match = /^(?:分值|分数)\s*[:：]\s*(\d+)/i.exec(line.trim());
  return match ? Number(match[1]) : fallback;
}

function parseSectionQuestions(lines, type, sectionMeta) {
  const questions = [];
  const answerKey = {};
  let i = 0;
  let qIndex = 0;

  while (i < lines.length) {
    const qMatch = /^(\d+)[.、)\]]\s*(.+)$/.exec(lines[i].trim());
    if (!qMatch) {
      i += 1;
      continue;
    }
    qIndex += 1;
    const title = qMatch[2].trim();
    i += 1;
    const { options, nextIndex } = parseOptions(lines, i);
    i = nextIndex;

    let answer = null;
    let score = type === "single" ? 5 : 7;
    while (i < lines.length && !/^(\d+)[.、)\]]/.test(lines[i]) && !/^##\s/.test(lines[i])) {
      const line = lines[i].trim();
      if (/^(?:答案|参考答案)/i.test(line)) answer = parseAnswerLine(line);
      if (/^(?:分值|分数)/i.test(line)) score = parseScoreLine(line, score);
      i += 1;
    }

    const id = slugId(sectionMeta.idPrefix, qIndex);
    const question = {
      id,
      type,
      difficulty: "中等",
      score,
      title,
      options,
    };
    if (type === "multiple" && Array.isArray(answer) && answer.length <= 2) {
      question.maxChoices = answer.length;
    }
    questions.push(question);
    if (answer !== null) {
      answerKey[id] = { type, answer, score, title: title.slice(0, 40) };
    }
  }

  return { questions, answerKey };
}

function parseTextQuestion(lines, sectionMeta) {
  const questions = [];
  const answerKey = {};
  let i = 0;
  let qIndex = 0;
  while (i < lines.length) {
    const qMatch = /^(\d+)[.、)\]]\s*(.+)$/.exec(lines[i].trim());
    if (!qMatch) {
      i += 1;
      continue;
    }
    qIndex += 1;
    const title = qMatch[2].trim();
    i += 1;
    const promptLines = [];
    let answer = null;
    let score = 15;
    while (i < lines.length && !/^(\d+)[.、)\]]/.test(lines[i]) && !/^##\s/.test(lines[i])) {
      const line = lines[i].trim();
      if (/^(?:答案|参考答案)/i.test(line)) answer = parseAnswerLine(line);
      else if (/^(?:分值|分数)/i.test(line)) score = parseScoreLine(line, score);
      else if (line) promptLines.push(line);
      i += 1;
    }
    const id = slugId(sectionMeta.idPrefix, qIndex);
    questions.push({
      id,
      type: "text",
      difficulty: "很难",
      score,
      title,
      prompt: promptLines.join("\n"),
      placeholder: "请输入答案",
    });
    if (answer !== null) {
      answerKey[id] = { type: "text", answer: String(answer), score, title: title.slice(0, 40) };
    }
  }
  return { questions, answerKey };
}

function parseCodeSection(lines) {
  const codeProblems = [];
  const codeProblemTests = {};
  const codeProblemMeta = {};
  const answerKey = {};
  let i = 0;
  let current = null;

  function flush() {
    if (!current) return;
    codeProblems.push({
      id: current.id,
      title: current.title,
      difficulty: "很难",
      body: current.body,
    });
    codeProblemMeta[current.id] = current.title;
    if (current.tests.length) codeProblemTests[current.id] = current.tests;
  }

  while (i < lines.length) {
    const line = lines[i].trim();
    const idMatch = /^ID\s*[:：]\s*(\S+)/i.exec(line);
    const titleMatch = /^标题\s*[:：]\s*(.+)$/i.exec(line);
    const sectionMatch = /^(题目描述|输入格式|输出格式|输入样例\s*\d+|输出样例\s*\d+|样例解释|数据范围)\s*[:：]?\s*(.*)$/i.exec(line);
    const testMatch = /^测试用例\s*[:：]\s*(.+)$/i.exec(line);

    if (idMatch) {
      flush();
      current = { id: idMatch[1], title: idMatch[1], body: [], tests: [], testBuffer: null };
      i += 1;
      continue;
    }
    if (current && titleMatch) {
      current.title = titleMatch[1].trim();
      i += 1;
      continue;
    }
    if (current && sectionMatch) {
      const label = sectionMatch[1].replace(/\s+\d+$/, (m) => m.trim());
      const content = sectionMatch[2] || "";
      const parts = [label];
      i += 1;
      const extra = [];
      while (i < lines.length) {
        const next = lines[i];
        if (
          !next.trim() ||
          /^ID\s*[:：]/i.test(next) ||
          /^标题\s*[:：]/i.test(next) ||
          /^(题目描述|输入格式|输出格式|输入样例|输出样例|样例解释|数据范围|测试用例)\s*[:：]?/i.test(next) ||
          /^##\s/.test(next)
        ) {
          break;
        }
        extra.push(next);
        i += 1;
      }
      current.body.push([label, [content, ...extra].filter(Boolean).join("\n").trim()]);
      continue;
    }
    if (current && testMatch) {
      current.testBuffer = { name: testMatch[1].trim(), inputLines: [], output: "" };
      i += 1;
      continue;
    }
    if (current?.testBuffer) {
      if (/^输入\s*[:：]?/i.test(line)) {
        i += 1;
        while (i < lines.length && !/^输出\s*[:：]?/i.test(lines[i].trim()) && lines[i].trim()) {
          current.testBuffer.inputLines.push(lines[i]);
          i += 1;
        }
        continue;
      }
      if (/^输出\s*[:：]?\s*(.*)$/i.test(line)) {
        const outMatch = /^输出\s*[:：]?\s*(.*)$/i.exec(line);
        const first = outMatch[1];
        const outputLines = first ? [first] : [];
        i += 1;
        while (i < lines.length && lines[i].trim() && !/^(测试用例|ID|##)/i.test(lines[i])) {
          outputLines.push(lines[i].trim());
          i += 1;
        }
        current.tests.push({
          name: current.testBuffer.name,
          input: `${current.testBuffer.inputLines.join("\n")}\n`,
          output: outputLines.join("\n").trim(),
        });
        current.testBuffer = null;
        continue;
      }
    }
    i += 1;
  }
  flush();
  return { codeProblems, codeProblemTests, codeProblemMeta, answerKey };
}

function parseExamTemplate(text) {
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n");
  const errors = [];
  let title = "导入试卷";
  let durationMinutes = 40;
  const sections = [];
  let mergedAnswerKey = {};
  let codeProblems = [];
  let codeProblemTests = {};
  let codeProblemMeta = {};

  const titleMatch = lines.find((line) => /^#\s+/.test(line.trim()));
  if (titleMatch) title = titleMatch.trim().replace(/^#\s+/, "");
  const durationMatch = lines.find((line) => /^时长\s*[:：]/i.test(line.trim()));
  if (durationMatch) {
    const m = /(\d+)/.exec(durationMatch);
    if (m) durationMinutes = Number(m[1]);
  }

  const sectionRegex = /^##\s+(.+)$/;
  let i = 0;
  while (i < lines.length) {
    const match = sectionRegex.exec(lines[i].trim());
    if (!match) {
      i += 1;
      continue;
    }
    const sectionName = match[1].trim();
    i += 1;
    const sectionLines = [];
    while (i < lines.length && !/^##\s+/.test(lines[i].trim())) {
      sectionLines.push(lines[i]);
      i += 1;
    }

    if (/单选/.test(sectionName)) {
      const { questions, answerKey } = parseSectionQuestions(sectionLines, "single", { idPrefix: "single" });
      sections.push({
        id: "single",
        number: "02",
        title: sectionName,
        description: "每题只有一个正确答案。",
        questions,
      });
      mergedAnswerKey = { ...mergedAnswerKey, ...answerKey };
    } else if (/多选/.test(sectionName)) {
      const { questions, answerKey } = parseSectionQuestions(sectionLines, "multiple", { idPrefix: "multi" });
      sections.push({
        id: "multiple",
        number: "03",
        title: sectionName,
        description: "每题答案不唯一，少选部分得分，多选不得分。",
        questions,
      });
      mergedAnswerKey = { ...mergedAnswerKey, ...answerKey };
    } else if (/填空|排序|综合/.test(sectionName)) {
      const { questions, answerKey } = parseTextQuestion(sectionLines, { idPrefix: "text" });
      sections.push({
        id: "integrated",
        number: "04",
        title: sectionName,
        description: "请按题目要求填写答案。",
        questions,
      });
      mergedAnswerKey = { ...mergedAnswerKey, ...answerKey };
    } else if (/代码/.test(sectionName)) {
      const parsed = parseCodeSection(sectionLines);
      codeProblems = parsed.codeProblems;
      codeProblemTests = parsed.codeProblemTests;
      codeProblemMeta = parsed.codeProblemMeta;
      mergedAnswerKey = { ...mergedAnswerKey, ...parsed.answerKey };
    }
  }

  const questionCount = sections.reduce((sum, s) => sum + (s.questions?.length || 0), 0);
  if (!questionCount && !codeProblems.length) {
    errors.push("未解析到任何题目，请检查文档格式。");
  }
  const missingAnswers = Object.entries(mergedAnswerKey).filter(([, v]) => v.answer === null || v.answer === undefined);
  if (missingAnswers.length) errors.push(`有 ${missingAnswers.length} 道题缺少答案。`);

  return {
    ok: errors.length === 0,
    errors,
    paper: {
      title,
      durationMinutes,
      source: "",
      sections,
      codeProblems,
      answerKey: mergedAnswerKey,
      codeProblemTests,
      codeProblemMeta,
    },
    parseMethod: "template",
  };
}

module.exports = { parseExamTemplate };
