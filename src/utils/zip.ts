import type { GeneratedFile } from './code-generator';

// ZIP STORE format: UTF-8 filenames, CRC32, local headers and central directory.
export function createZip(files: GeneratedFile[]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [], central: Uint8Array[] = [];
  let offset = 0;
  const header = (size: number) => new DataView(new ArrayBuffer(size));
  for (const file of files) {
    const name = encoder.encode(file.path), data = encoder.encode(file.content);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const local = header(30);
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true);
    local.setUint16(6, 0x800, true); local.setUint16(12, 33, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true); local.setUint16(26, name.length, true);
    chunks.push(new Uint8Array(local.buffer), name, data);
    const entry = header(46);
    entry.setUint32(0, 0x02014b50, true); entry.setUint16(4, 20, true); entry.setUint16(6, 20, true);
    entry.setUint16(8, 0x800, true); entry.setUint16(14, 33, true);
    entry.setUint32(16, crc, true); entry.setUint32(20, data.length, true);
    entry.setUint32(24, data.length, true); entry.setUint16(28, name.length, true);
    entry.setUint32(42, offset, true);
    central.push(new Uint8Array(entry.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const centralSize = central.reduce((sum, c) => sum + c.length, 0);
  const end = header(22);
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true); end.setUint32(12, centralSize, true); end.setUint32(16, offset, true);
  const result = new Uint8Array(offset + centralSize + 22);
  let cursor = 0;
  for (const chunk of [...chunks, ...central, new Uint8Array(end.buffer)]) { result.set(chunk, cursor); cursor += chunk.length; }
  return result;
}
