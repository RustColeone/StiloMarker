import { isImageFileName } from "../domain/project-model.js";
import { builtinTypes } from "../modules/file-types/index.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

// MIME types come from the File types module (protocol/file-types.json).
function getMimeTypeForFileName(name) {
  return builtinTypes.mimeOf(name);
}

function encodeBase64(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function decodeBase64(value) {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function bytesToDataUrl(bytes, mimeType) {
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

function dataUrlToBytes(dataUrl) {
  const match = /^data:([^;,]+)?(?:;charset=[^;,]+)?(?:;(base64))?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) {
    throw new Error("Invalid data URL.");
  }

  const mimeType = match[1] || "application/octet-stream";
  const isBase64 = match[2] === "base64";
  const payload = match[3] || "";
  const bytes = isBase64
    ? decodeBase64(payload)
    : encoder.encode(decodeURIComponent(payload));

  return { mimeType, bytes };
}

function dataUrlToBlob(dataUrl) {
  const { mimeType, bytes } = dataUrlToBytes(dataUrl);
  return new Blob([bytes], { type: mimeType });
}

async function readFileAsProjectContent(file, fileName = file.name) {
  if (isImageFileName(fileName)) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    return bytesToDataUrl(bytes, getMimeTypeForFileName(fileName));
  }

  return file.text();
}

function getExportBytes(fileName, content) {
  if (isImageFileName(fileName)) {
    return dataUrlToBytes(content).bytes;
  }
  return encoder.encode(content);
}

function decodeTextBytes(bytes) {
  return decoder.decode(bytes);
}

export {
  bytesToDataUrl,
  dataUrlToBlob,
  dataUrlToBytes,
  decodeTextBytes,
  getExportBytes,
  getMimeTypeForFileName,
  readFileAsProjectContent
};