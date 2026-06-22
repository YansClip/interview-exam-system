const fs = require("fs");
const path = require("path");
const PDFDocument = require("pdfkit");

const PAGE_W = 595.28;
const PAGE_H = 841.89;
const MARGIN = 34;
const CONTENT_W = PAGE_W - MARGIN * 2;
const FOOTER_Y = PAGE_H - 36;

function resolveFontPath() {
  const candidates = [
    path.join(__dirname, "vendor/fonts/NotoSansSC-Regular.otf"),
    "/Library/Fonts/Arial Unicode.ttf",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
  ];
  for (const fontPath of candidates) {
    if (fs.existsSync(fontPath)) return fontPath;
  }
  throw new Error("未找到中文字体，请将 NotoSansSC-Regular.otf 放入 vendor/fonts/。");
}

function buildExamExportFilename(paper) {
  const job = String(paper?.job || "岗位").replace(/[/\\?%*:|"<>]/g, "_");
  const title = String(paper?.title || "试卷").replace(/[/\\?%*:|"<>]/g, "_");
  const date = new Date().toISOString().slice(0, 10);
  return `${job}_${title}_${date}.pdf`;
}

function optionLabel(index) {
  return String.fromCharCode("A".charCodeAt(0) + index);
}

function ensureSpace(doc, y, needed, fontPath) {
  if (y + needed <= FOOTER_Y - 20) return y;
  doc.addPage();
  doc.font(fontPath).fontSize(8).fillColor("#999999").text("答题系统 · 试卷导出", MARGIN, FOOTER_Y, {
    width: CONTENT_W,
    align: "center",
  });
  return MARGIN + 10;
}

function drawSectionHeader(doc, fontPath, section, y) {
  y = ensureSpace(doc, y, 40, fontPath);
  doc.font(fontPath).fontSize(12).fillColor("#111111").text(`${section.number || ""} ${section.title || ""}`.trim(), MARGIN, y, {
    width: CONTENT_W,
  });
  y += 18;
  if (section.description) {
    doc.font(fontPath).fontSize(9).fillColor("#666666").text(section.description, MARGIN, y, { width: CONTENT_W });
    y += doc.heightOfString(section.description, { width: CONTENT_W }) + 8;
  }
  return y;
}

function drawQuestion(doc, fontPath, question, questionNo, y) {
  const titleText = `${questionNo}. ${question.title || ""}`;
  const titleHeight = doc.font(fontPath).fontSize(10).heightOfString(titleText, { width: CONTENT_W });
  y = ensureSpace(doc, y, titleHeight + 20, fontPath);
  doc.font(fontPath).fontSize(10).fillColor("#111111").text(titleText, MARGIN, y, { width: CONTENT_W });
  y += titleHeight + 6;

  if (question.prompt) {
    const promptHeight = doc.font(fontPath).fontSize(9).heightOfString(question.prompt, { width: CONTENT_W, lineGap: 2 });
    y = ensureSpace(doc, y, promptHeight + 10, fontPath);
    doc.font(fontPath).fontSize(9).fillColor("#333333").text(question.prompt, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
    y += promptHeight + 8;
  }

  if (Array.isArray(question.options)) {
    question.options.forEach((option, index) => {
      const line = `${optionLabel(index)}. ${option}`;
      const lineHeight = doc.font(fontPath).fontSize(9).heightOfString(line, { width: CONTENT_W - 12 });
      y = ensureSpace(doc, y, lineHeight + 4, fontPath);
      doc.font(fontPath).fontSize(9).fillColor("#333333").text(line, MARGIN + 8, y, { width: CONTENT_W - 12 });
      y += lineHeight + 4;
    });
  }

  return y + 10;
}

function drawCodeProblem(doc, fontPath, problem, questionNo, y) {
  y = ensureSpace(doc, y, 30, fontPath);
  doc.font(fontPath).fontSize(11).fillColor("#111111").text(`${questionNo}. ${problem.title || ""}`, MARGIN, y, {
    width: CONTENT_W,
  });
  y += 18;

  for (const block of problem.body || []) {
    const heading = Array.isArray(block) ? block[0] : "";
    const content = Array.isArray(block) ? block.slice(1).join("\n") : String(block);
    if (heading) {
      y = ensureSpace(doc, y, 20, fontPath);
      doc.font(fontPath).fontSize(9).fillColor("#111111").text(heading, MARGIN, y, { width: CONTENT_W });
      y += 14;
    }
    if (content) {
      const contentHeight = doc.font(fontPath).fontSize(8.5).heightOfString(content, { width: CONTENT_W, lineGap: 2 });
      y = ensureSpace(doc, y, contentHeight + 8, fontPath);
      doc.font(fontPath).fontSize(8.5).fillColor("#333333").text(content, MARGIN, y, { width: CONTENT_W, lineGap: 2 });
      y += contentHeight + 8;
    }
  }

  return y + 10;
}

function generateExamPdfBuffer(paper) {
  if (!paper) throw new Error("试卷不存在。");
  const fontPath = resolveFontPath();

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: MARGIN });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font(fontPath).fontSize(16).fillColor("#111111").text(paper.title || "技术笔试", MARGIN, MARGIN, {
      width: CONTENT_W,
    });
    doc
      .font(fontPath)
      .fontSize(9)
      .fillColor("#666666")
      .text(
        `岗位：${paper.job || "-"}    答题时长：${paper.durationMinutes || 40} 分钟    导出时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        MARGIN,
        MARGIN + 24,
        { width: CONTENT_W },
      );

    let y = MARGIN + 52;
    let questionNo = 0;

    for (const section of paper.sections || []) {
      y = drawSectionHeader(doc, fontPath, section, y);
      for (const question of section.questions || []) {
        questionNo += 1;
        y = drawQuestion(doc, fontPath, question, questionNo, y);
      }
    }

    if ((paper.codeProblems || []).length) {
      y = ensureSpace(doc, y, 30, fontPath);
      doc.font(fontPath).fontSize(12).fillColor("#111111").text("代码题", MARGIN, y, { width: CONTENT_W });
      y += 20;
      for (const problem of paper.codeProblems) {
        questionNo += 1;
        y = drawCodeProblem(doc, fontPath, problem, questionNo, y);
      }
    }

    doc.font(fontPath).fontSize(8).fillColor("#999999").text("答题系统 · 试卷导出（不含标准答案）", MARGIN, FOOTER_Y, {
      width: CONTENT_W,
      align: "center",
    });

    doc.end();
  });
}

module.exports = {
  generateExamPdfBuffer,
  buildExamExportFilename,
};
