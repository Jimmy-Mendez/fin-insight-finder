import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// Vite-friendly worker import
// The ?url suffix makes Vite return the URL string for the asset
// pdfjs 4 uses build/pdf.worker.min.js path
// If this path changes in future versions, update accordingly
import workerUrl from "pdfjs-dist/build/pdf.worker.min.js?url";

let workerConfigured = false;

function ensureWorker() {
  if (!workerConfigured) {
    // @ts-ignore - pdfjs types may not include workerSrc
    GlobalWorkerOptions.workerSrc = workerUrl;
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
