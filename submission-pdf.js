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

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}

function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return "-";
  const minutes = Math.floor(seconds / 60);
  const restSeconds = seconds % 60;
  return `${minutes} 分 ${restSeconds} 秒`;
}

function formatAnswer(answer) {
  if (Array.isArray(answer)) return answer.join(", ") || "-";
  return answer || "-";
}

function buildSubmissionExportFilename(submission) {
  const name = String(submission.candidate?.name || "候选人").replace(/[/\\?%*:|"<>]/g, "_");
  const phone = String(submission.candidate?.contact || "").replace(/\D/g, "");
  const date = submission.submittedAt ? submission.submittedAt.slice(0, 10) : new Date().toISOString().slice(0, 10);
  return `${name}_${phone || "unknown"}_答题情况_${date}.pdf`;
}

function fitText(doc, text, width, height, fontPath, fontSize = 8, options = {}) {
  const raw = String(text || "-").replace(/\s+/g, " ").trim() || "-";
  doc.font(fontPath).fontSize(fontSize);
  if (doc.heightOfString(raw, { width, lineGap: options.lineGap || 1 }) <= height) return raw;
  let lo = 0;
  let hi = raw.length;
  let best = "...";
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const candidate = `${raw.slice(0, mid).trim()}...`;
    const candidateHeight = doc.heightOfString(candidate, { width, lineGap: options.lineGap || 1 });
    if (candidateHeight <= height) {
      best = candidate;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function writeFittedText(doc, text, x, y, width, height, fontPath, fontSize = 8, options = {}) {
  const fitted = fitText(doc, text, width, height, fontPath, fontSize, options);
  doc.font(fontPath).fontSize(fontSize).fillColor(options.color || "#111111").text(fitted, x, y, {
    width,
    height,
    lineGap: options.lineGap || 1,
  });
}

function drawSectionTitle(doc, fontPath, text, x, y, width) {
  doc.font(fontPath).fontSize(11).fillColor("#111111").text(text, x, y, { width, lineBreak: false });
  doc.moveTo(x, y + 18).lineTo(x + width, y + 18).strokeColor("#E5E7EB").lineWidth(0.6).stroke();
}

function drawScoreCard(doc, fontPath, label, value, x, y, w) {
  doc.roundedRect(x, y, w, 42, 5).fillColor("#F8FAFC").fill().strokeColor("#E5E7EB").lineWidth(0.6).stroke();
  doc.font(fontPath).fontSize(8).fillColor("#666666").text(label, x + 8, y + 7, { width: w - 16, lineBreak: false });
  doc.font(fontPath).fontSize(15).fillColor("#111111").text(String(value), x + 8, y + 21, { width: w - 16, lineBreak: false });
}

function drawMeta(doc, fontPath, submission, grade) {
  const rows = [
    ["候选人", submission.candidate?.name || "-"],
    ["手机号", submission.candidate?.contact || "-"],
    ["岗位", submission.candidate?.role || "-"],
    ["提交时间", formatDate(submission.submittedAt)],
    ["答题用时", formatDuration(grade.elapsedSeconds)],
  ];
  const x = MARGIN;
  const y = 86;
  rows.forEach((row, index) => {
    const rowY = y + index * 18;
    doc.font(fontPath).fontSize(9).fillColor("#666666").text(row[0], x, rowY, { width: 50, lineBreak: false });
    doc.font(fontPath).fontSize(9.5).fillColor("#111111").text(String(row[1]), x + 56, rowY, {
      width: 230,
      lineBreak: false,
    });
  });
}

function drawObjectiveTable(doc, fontPath, details, x, y, w) {
  drawSectionTitle(doc, fontPath, "客观题答题情况", x, y, w);
  const startY = y + 28;
  const cols = [24, 122, 48, 62, 40, 48];
  const headers = ["题", "题目", "作答", "标准", "得分", "判定"];
  let cx = x;
  doc.font(fontPath).fontSize(7.5);
  headers.forEach((header, index) => {
    doc.rect(cx, startY, cols[index], 18).fillColor("#F3F4F6").fill().strokeColor("#E5E7EB").lineWidth(0.45).stroke();
    doc.fillColor("#111111").text(header, cx + 3, startY + 5, { width: cols[index] - 6, lineBreak: false });
    cx += cols[index];
  });
  const rowH = 29;
  (details || []).slice(0, 10).forEach((item, rowIndex) => {
    const rowY = startY + 18 + rowIndex * rowH;
    const cells = [
      String(item.no ?? rowIndex + 1),
      item.title || "-",
      formatAnswer(item.submittedAnswer),
      formatAnswer(item.expectedAnswer),
      `${item.score ?? "-"} / ${item.maxScore ?? "-"}`,
      item.isCorrect ? "正确" : item.score > 0 ? "部分" : "错误",
    ];
    cx = x;
    cells.forEach((cell, index) => {
      doc.rect(cx, rowY, cols[index], rowH).strokeColor("#E1E4E8").lineWidth(0.45).stroke();
      writeFittedText(doc, cell, cx + 3, rowY + 5, cols[index] - 6, rowH - 8, fontPath, 7.5, {
        color: "#111111",
        lineGap: 0.5,
      });
      cx += cols[index];
    });
  });
}

function drawCodePanel(doc, fontPath, submission, grade, x, y, w, h) {
  const code = grade.code || {};
  drawSectionTitle(doc, fontPath, "代码题与复核备注", x, y, w);
  let cursorY = y + 30;

  const rows = [
    ["选题", code.problemTitle || submission.answers?.codeProblem || "-"],
    ["语言", code.language || submission.answers?.codeLanguage || "-"],
    ["代码题得分", `${grade.codeScore ?? "待评分"} / ${grade.codeMaxScore ?? 29}`],
    ["自动评测", code.autoGraded ? `${code.passedTests ?? 0} / ${code.totalTests ?? 0} 通过` : "未执行"],
    ["复核状态", code.reviewStatus || "待评分"],
  ];
  rows.forEach(([label, value]) => {
    doc.font(fontPath).fontSize(8).fillColor("#666666").text(label, x, cursorY, { width: 54, lineBreak: false });
    writeFittedText(doc, value, x + 58, cursorY, w - 58, 13, fontPath, 8.5);
    cursorY += 16;
  });

  cursorY += 3;
  doc.font(fontPath).fontSize(8).fillColor("#666666").text("复核备注", x, cursorY, { width: w, lineBreak: false });
  cursorY += 12;
  doc.roundedRect(x, cursorY, w, 82, 4).fillColor("#F8FAFC").fill().strokeColor("#E5E7EB").lineWidth(0.5).stroke();
  writeFittedText(doc, code.reviewNote || "暂无复核备注。", x + 7, cursorY + 7, w - 14, 68, fontPath, 7.6, {
    color: "#111111",
    lineGap: 0.5,
  });
  cursorY += 94;

  const results = (code.testResults || []).slice(0, 4);
  doc.font(fontPath).fontSize(8).fillColor("#666666").text("评测用例", x, cursorY, { width: w, lineBreak: false });
  cursorY += 12;
  if (!results.length) {
    doc.font(fontPath).fontSize(8).fillColor("#111111").text("暂无自动评测结果。", x, cursorY, { width: w });
    cursorY += 18;
  } else {
    results.forEach((item) => {
      const status = item.passed ? "正确" : "错误";
      writeFittedText(
        doc,
        `${item.name || "用例"}：${status}；期望 ${item.expectedOutput || "-"}，实际 ${item.actualOutput || "-"}`,
        x,
        cursorY,
        w,
        20,
        fontPath,
        7.4,
      );
      cursorY += 20;
    });
  }

  cursorY += 2;
  doc.font(fontPath).fontSize(8).fillColor("#666666").text("代码答案摘录", x, cursorY, { width: w, lineBreak: false });
  cursorY += 12;
  const codeBoxH = Math.max(44, y + h - cursorY);
  doc.roundedRect(x, cursorY, w, codeBoxH, 4).fillColor("#F8F8F8").fill().strokeColor("#E5E7EB").lineWidth(0.5).stroke();
  writeFittedText(doc, submission.answers?.codeAnswer || "未提交代码", x + 7, cursorY + 7, w - 14, codeBoxH - 14, fontPath, 7.4, {
    color: "#111111",
    lineGap: 0.5,
  });
}

function generateSubmissionPdfBuffer(submission) {
  return new Promise((resolve, reject) => {
    try {
      const fontPath = resolveFontPath();
      const doc = new PDFDocument({
        size: "A4",
        margin: 0,
        bufferPages: true,
        autoFirstPage: true,
      });
      const chunks = [];
      doc.on("data", (chunk) => chunks.push(chunk));
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);

      const grade = submission.grade || {};
      const code = grade.code || {};
      doc.font(fontPath);

      doc.font(fontPath).fontSize(20).fillColor("#111111").text("试卷答题情况", MARGIN, 42, {
        width: CONTENT_W,
        lineBreak: false,
      });
      doc.font(fontPath).fontSize(8.5).fillColor("#666666").text(`导出时间：${formatDate(new Date().toISOString())}`, MARGIN, 70, {
        width: CONTENT_W,
        lineBreak: false,
      });

      doc.font(fontPath).fontSize(24).fillColor("#111111").text(`${grade.score ?? "-"} / ${grade.maxScore ?? "-"}`, PAGE_W - MARGIN - 118, 52, {
        width: 118,
        align: "right",
        lineBreak: false,
      });
      doc.font(fontPath).fontSize(8.5).fillColor("#666666").text("总分", PAGE_W - MARGIN - 118, 82, {
        width: 118,
        align: "right",
        lineBreak: false,
      });

      drawMeta(doc, fontPath, submission, grade);

      const cardY = 175;
      const cardW = (CONTENT_W - 18) / 4;
      drawScoreCard(doc, fontPath, "总分", `${grade.score ?? "-"} / ${grade.maxScore ?? "-"}`, MARGIN, cardY, cardW);
      drawScoreCard(doc, fontPath, "客观题", `${grade.objectiveScore ?? "-"} / ${grade.objectiveMaxScore ?? "-"}`, MARGIN + cardW + 6, cardY, cardW);
      drawScoreCard(doc, fontPath, "代码题", `${grade.codeScore ?? "待评分"} / ${grade.codeMaxScore ?? 29}`, MARGIN + (cardW + 6) * 2, cardY, cardW);
      drawScoreCard(doc, fontPath, "复核", code.reviewStatus || (grade.manualReviewRequired ? "需复核" : "不需要"), MARGIN + (cardW + 6) * 3, cardY, cardW);

      const panelY = 240;
      drawObjectiveTable(doc, fontPath, grade.details || [], MARGIN, panelY, 344);
      drawCodePanel(doc, fontPath, submission, grade, MARGIN + 362, panelY, CONTENT_W - 362, 432);

      doc.moveTo(MARGIN, FOOTER_Y - 8).lineTo(MARGIN + CONTENT_W, FOOTER_Y - 8).strokeColor("#E5E7EB").lineWidth(0.5).stroke();
      doc.font(fontPath).fontSize(8.5).fillColor("#888888").text("答题系统 · 试卷答题情况 · A4 单页摘要", MARGIN, FOOTER_Y, {
        width: CONTENT_W,
        align: "center",
        lineBreak: false,
      });

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  buildSubmissionExportFilename,
  generateSubmissionPdfBuffer,
  formatDate,
  formatDuration,
  formatAnswer,
};
