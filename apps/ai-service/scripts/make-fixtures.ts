// Dev-only: regenerates binary fixtures in test/fixtures. Run: tsx scripts/make-fixtures.ts
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Document, Packer, Paragraph } from "docx";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const dir = join(dirname(fileURLToPath(import.meta.url)), "../test/fixtures");
const md = readFileSync(join(dir, "sop-refund.md"), "utf8");
const lines = md.split("\n").map((l) => l.replace(/^#+\s*/, "").replace(/^- /, "* "));

async function textPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let page = pdf.addPage([595, 842]);
  let y = 800;
  for (const line of lines) {
    if (y < 50) {
      page = pdf.addPage([595, 842]);
      y = 800;
    }
    if (line.trim()) page.drawText(line.slice(0, 95), { x: 40, y, size: 10, font });
    y -= 14;
  }
  return pdf.save();
}

async function scannedPdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595, 842]);
  page.drawRectangle({ x: 50, y: 50, width: 495, height: 742, color: rgb(0.8, 0.8, 0.8) });
  return pdf.save();
}

writeFileSync(join(dir, "sop-refund.pdf"), await textPdf());
writeFileSync(join(dir, "scanned.pdf"), await scannedPdf());
const doc = new Document({ sections: [{ children: lines.map((l) => new Paragraph(l)) }] });
writeFileSync(join(dir, "sop.docx"), await Packer.toBuffer(doc));
console.log("fixtures written");
