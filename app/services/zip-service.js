function createCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
}

const CRC_TABLE = createCrc32Table();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value, true);
}

function createZip(entries) {
  const fileRecords = [];
  const centralRecords = [];
  let fileOffset = 0;

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path);
    const contentBytes = entry.bytes instanceof Uint8Array ? entry.bytes : encoder.encode(entry.content ?? "");
    const checksum = crc32(contentBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length + contentBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, 0);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, 0);
    writeUint16(localView, 12, 0);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, contentBytes.length);
    writeUint32(localView, 22, contentBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localHeader.set(contentBytes, 30 + nameBytes.length);
    fileRecords.push(localHeader);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, 0);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, 0);
    writeUint16(centralView, 14, 0);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, contentBytes.length);
    writeUint32(centralView, 24, contentBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, fileOffset);
    centralHeader.set(nameBytes, 46);
    centralRecords.push(centralHeader);

    fileOffset += localHeader.length;
  }

  const centralSize = centralRecords.reduce((sum, record) => sum + record.length, 0);
  const endRecord = new Uint8Array(22);
  const endView = new DataView(endRecord.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, entries.length);
  writeUint16(endView, 10, entries.length);
  writeUint32(endView, 12, centralSize);
  writeUint32(endView, 16, fileOffset);
  writeUint16(endView, 20, 0);

  return new Blob([...fileRecords, ...centralRecords, endRecord], { type: "application/zip" });
}

function findEndOfCentralDirectory(bytes) {
  for (let offset = bytes.length - 22; offset >= 0; offset -= 1) {
    if (
      bytes[offset] === 0x50 &&
      bytes[offset + 1] === 0x4b &&
      bytes[offset + 2] === 0x05 &&
      bytes[offset + 3] === 0x06
    ) {
      return offset;
    }
  }
  throw new Error("ZIP end-of-central-directory record not found.");
}

async function inflateDeflateRaw(bytes) {
  if (typeof DecompressionStream !== "function") {
    throw new Error("Compressed ZIP import requires browser support for DecompressionStream.");
  }

  const streamKinds = ["deflate-raw", "deflate"];
  let lastError = null;

  for (const kind of streamKinds) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(kind));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error("Unable to decompress ZIP entry.");
}

async function extractZipEntries(blob) {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const endOffset = findEndOfCentralDirectory(bytes);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  let offset = centralDirectoryOffset;
  const entries = [];

  for (let index = 0; index < entryCount; index += 1) {
    const signature = view.getUint32(offset, true);
    if (signature !== 0x02014b50) {
      throw new Error("Invalid ZIP central directory entry.");
    }

    const flags = view.getUint16(offset + 8, true);
    const compressionMethod = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + nameLength);
    const path = decoder.decode(nameBytes);
    offset += 46 + nameLength + extraLength + commentLength;

    if (path.endsWith("/")) {
      continue;
    }

    const localSignature = view.getUint32(localHeaderOffset, true);
    if (localSignature !== 0x04034b50) {
      throw new Error(`Invalid local ZIP header for ${path}.`);
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedBytes = bytes.slice(dataOffset, dataOffset + compressedSize);

    let contentBytes;
    if (compressionMethod === 0) {
      contentBytes = compressedBytes;
    } else if (compressionMethod === 8) {
      contentBytes = await inflateDeflateRaw(compressedBytes);
    } else {
      throw new Error(`Unsupported ZIP compression method ${compressionMethod} for ${path}.`);
    }

    if ((flags & 0x01) !== 0) {
      throw new Error(`Encrypted ZIP entries are not supported: ${path}.`);
    }

    if (contentBytes.length !== uncompressedSize) {
      throw new Error(`ZIP entry size mismatch for ${path}.`);
    }

    entries.push({
      path,
      bytes: contentBytes,
      content: decoder.decode(contentBytes)
    });
  }

  return entries;
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export { createZip, downloadBlob, extractZipEntries };