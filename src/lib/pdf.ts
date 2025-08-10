import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// Use Vite worker import for pdf.js worker
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";

let workerConfigured = false;

function ensureWorker() {
  if (!workerConfigured) {
    // @ts-ignore - pdfjs types may not include workerPort yet
    GlobalWorkerOptions.workerPort = new PdfWorker();
    workerConfigured = true;
  }
}

export async function extractPdfText(file: File): Promise<{ text: string; pages: number }>
{
  ensureWorker();
  const buf = await file.arrayBuffer();
  const pdf = await getDocument({ data: buf }).promise;
  const pages = pdf.numPages;
  let text = "";
  for (let i = 1; i <= pages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => ('str' in it ? (it as any).str : '')).filter(Boolean);
    text += strings.join(" ") + "\n\n";
  }
  try { await pdf.destroy(); } catch {}
  return { text: text.trim(), pages };
}
