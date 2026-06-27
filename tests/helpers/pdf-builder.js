// PDF builder utilities using pdf-lib
// Each drawText call creates ONE text item. Lines at different Y coords produce newlines
// when extracted by PDF.js (Y diff > 5pt triggers newline in uploader.js).

import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

export const PAGE_WIDTH  = 612;
export const PAGE_HEIGHT = 792;
export const MARGIN      = 72;
export const BODY_WIDTH  = PAGE_WIDTH - MARGIN * 2;  // 468pt

/**
 * Wrap text into lines that fit within maxWidth at the given font size.
 */
export function wrapText(text, font, size, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && cur) {
      lines.push(cur);
      cur = w;
    } else {
      cur = test;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/**
 * Draw a text block (multiple wrapped lines) starting at (x, y), going downward.
 * Returns the Y position after the last line.
 */
export function drawBlock(page, text, font, size, x, startY, maxWidth, lineSpacing = 1.4) {
  const lines = wrapText(text, font, size, maxWidth);
  let y = startY;
  for (const line of lines) {
    if (y < 60) break; // don't overflow off page
    page.drawText(line, { x, y, font, size, color: rgb(0, 0, 0) });
    y -= size * lineSpacing;
  }
  return y;
}

/**
 * Draw a chapter opening page with heading at top and sparse body text.
 * Sparse = < 200 words so ALL-CAPS headings are detected by chunker's pass 2.
 * Returns the PDFPage.
 */
export async function addChapterPage(doc, boldFont, bodyFont, headingLines, bodyText) {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  // Draw heading lines at decreasing Y values (> 5pt apart → newlines in extraction)
  let y = 680;
  for (const line of headingLines) {
    page.drawText(line, { x: MARGIN, y, font: boldFont, size: 16, color: rgb(0, 0, 0) });
    y -= 24; // 24pt gap ensures Y diff > 5pt
  }

  // Sparse body (100–180 words to stay below SPARSE_WORDS=200)
  if (bodyText) {
    y -= 20;
    drawBlock(page, bodyText, bodyFont, 11, MARGIN, y, BODY_WIDTH);
  }

  return page;
}

/**
 * Add a content page with 3 paragraphs of prose.
 * Each line is a separate drawText call at decreasing Y → reconstructed by PDF.js.
 */
export function addContentPage(doc, bodyFont, paragraphs) {
  const page = doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  let y = 720;
  const lineSize = 11;
  const lineSpacing = lineSize * 1.4;

  for (const para of paragraphs) {
    const lines = wrapText(para, bodyFont, lineSize, BODY_WIDTH);
    for (const line of lines) {
      if (y < 60) break;
      page.drawText(line, { x: MARGIN, y, font: bodyFont, size: lineSize, color: rgb(0, 0, 0) });
      y -= lineSpacing;
    }
    y -= lineSpacing; // paragraph gap
  }

  return page;
}

/**
 * Sample paragraph text generator — produces varied prose of approximately wordCount words.
 */
export function makeParagraph(seed, wordCount = 100) {
  const sentences = [
    `The principles outlined in this section form the bedrock of understanding for practitioners in the field.`,
    `Through careful analysis and systematic application, readers can develop a deeper appreciation of the underlying concepts.`,
    `Each idea builds upon previous foundations, creating a coherent framework for knowledge acquisition.`,
    `Practical implementation requires attention to detail and a willingness to adapt methods to specific circumstances.`,
    `The evidence suggests that consistent practice leads to mastery and long-term retention of key principles.`,
    `Scholars and practitioners alike have recognized the importance of integrating theory with real-world application.`,
    `This approach enables a more nuanced understanding of complex phenomena encountered in professional settings.`,
    `The relationship between different concepts reveals deeper patterns that inform more effective decision-making.`,
    `By examining these principles carefully, readers develop the analytical tools necessary for continued growth.`,
    `Success in applying these ideas depends on both intellectual understanding and practical experimentation.`,
    `Historical context provides valuable perspective on how these principles have evolved over time.`,
    `Contemporary research continues to refine and expand our understanding of these fundamental concepts.`,
    `The implications of these findings extend across multiple domains of professional and personal development.`,
    `Effective synthesis of these ideas requires both breadth of knowledge and depth of understanding.`,
  ];

  const idx = seed % sentences.length;
  let result = '';
  const targetWords = wordCount;
  let usedSentences = 0;
  while (result.split(' ').length < targetWords) {
    result += (result ? ' ' : '') + sentences[(idx + usedSentences) % sentences.length];
    usedSentences++;
  }
  return result.split(' ').slice(0, targetWords).join(' ');
}

/**
 * Create a complete PDF document and return the bytes.
 * pageCallback(doc, boldFont, bodyFont, pageIndex) is called for each page.
 */
export async function buildPDF(pageCallback, pageCount) {
  const doc      = await PDFDocument.create();
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);
  const bodyFont = await doc.embedFont(StandardFonts.Helvetica);

  for (let i = 0; i < pageCount; i++) {
    await pageCallback(doc, boldFont, bodyFont, i);
  }

  return doc.save();
}
