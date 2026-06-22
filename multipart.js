function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || "");
  if (!match) throw new Error("无法识别上传格式。");
  const boundary = match[1] || match[2];
  const delimiter = Buffer.from(`--${boundary}`);
  const parts = [];
  let start = buffer.indexOf(delimiter) + delimiter.length;

  while (start < buffer.length) {
    if (buffer[start] === 45 && buffer[start + 1] === 45) break;
    if (buffer[start] === 13 && buffer[start + 1] === 10) start += 2;
    const end = buffer.indexOf(delimiter, start);
    const partBuffer = buffer.slice(start, end === -1 ? buffer.length : end - 2);
    const headerEnd = partBuffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const headerText = partBuffer.slice(0, headerEnd).toString("utf8");
    const body = partBuffer.slice(headerEnd + 4);
    const nameMatch = /name="([^"]+)"/i.exec(headerText);
    const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
    parts.push({
      name: nameMatch ? nameMatch[1] : "",
      filename: filenameMatch ? filenameMatch[1] : "",
      data: body,
    });
    if (end === -1) break;
    start = end + delimiter.length;
  }

  const fields = {};
  let file = null;
  for (const part of parts) {
    if (part.filename) {
      file = part;
    } else if (part.name) {
      fields[part.name] = part.data.toString("utf8");
    }
  }
  return { fields, file };
}

function readMultipartRequest(request, maxBytes = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("上传文件过大。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        const buffer = Buffer.concat(chunks);
        resolve(parseMultipart(buffer, request.headers["content-type"] || ""));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

module.exports = { readMultipartRequest };
