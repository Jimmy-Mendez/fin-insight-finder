export function chunkText(text: string, chunkSize = 1500, overlap = 200): string[] {
  const chunks: string[] = [];
  if (!text) return chunks;

  // Prefer splitting by paragraphs to keep semantics
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  let current = "";
  for (const p of paragraphs) {
    if ((current + (current ? "\n\n" : "") + p).length <= chunkSize) {
      current = current ? current + "\n\n" + p : p;
    } else {
      if (current) chunks.push(current);
      if (p.length <= chunkSize) {
        current = p;
      } else {
        // Hard wrap long paragraph
        for (let i = 0; i < p.length; i += chunkSize - overlap) {
          chunks.push(p.slice(i, i + chunkSize));
        }
        current = "";
      }
    }
  }
  if (current) chunks.push(current);

  // Add overlap by merging with previous tails if needed
  if (overlap > 0 && chunks.length > 1) {
    const withOverlap: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      if (i === 0) withOverlap.push(chunks[i]);
      else {
        const prev = chunks[i - 1];
        const tail = prev.slice(Math.max(0, prev.length - overlap));
        withOverlap.push(`${tail}\n\n${chunks[i]}`.slice(0, chunkSize));
      }
    }
    return withOverlap;
  }

  return chunks;
}
