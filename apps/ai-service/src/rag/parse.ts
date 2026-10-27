import mammoth from "mammoth";
import { PDFParse } from "pdf-parse";

export class UnsupportedType extends Error {
  constructor(mime: string) {
    super(`unsupported type: ${mime}`);
    this.name = "UnsupportedType";
  }
}

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export async function extractText(buf: Buffer, mime: string): Promise<string> {
  const type = mime.split(";")[0]!.trim().toLowerCase();
  switch (type) {
    case "application/pdf":
      return await pdfText(buf);
    case DOCX_MIME:
      return (await mammoth.extractRawText({ buffer: buf })).value;
    case "text/markdown":
    case "text/plain":
      return buf.toString("utf8");
    default:
      throw new UnsupportedType(mime);
  }
}

async function pdfText(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buf) });
  try {
    return (await parser.getText({ pageJoiner: "" })).text;
  } finally {
    await parser.destroy();
  }
}
