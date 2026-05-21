import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const outPath = resolve("docs", "GameHub-User-Manual.pdf");
mkdirSync(dirname(outPath), { recursive: true });

const pageWidth = 841.89;
const pageHeight = 595.28;
const margin = 30;
const contentWidth = pageWidth - margin * 2;

function esc(text) {
  return String(text)
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function wrapText(text, maxWidth, size) {
  const avg = size * 0.49;
  const maxChars = Math.max(12, Math.floor(maxWidth / avg));
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

class Page {
  constructor() {
    this.ops = [];
    this.y = pageHeight - margin;
  }

  raw(op) {
    this.ops.push(op);
  }

  save() { this.raw("q"); }
  restore() { this.raw("Q"); }

  fillColor(hex) {
    const [r, g, b] = rgb(hex);
    this.raw(`${r} ${g} ${b} rg`);
  }

  strokeColor(hex) {
    const [r, g, b] = rgb(hex);
    this.raw(`${r} ${g} ${b} RG`);
  }

  lineWidth(w) {
    this.raw(`${w} w`);
  }

  rect(x, y, w, h, fill = true) {
    this.raw(`${x.toFixed(2)} ${y.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re ${fill ? "f" : "S"}`);
  }

  line(x1, y1, x2, y2) {
    this.raw(`${x1.toFixed(2)} ${y1.toFixed(2)} m ${x2.toFixed(2)} ${y2.toFixed(2)} l S`);
  }

  text(text, x, y, size = 10, bold = false, color = "#1f2937") {
    this.fillColor(color);
    this.raw(`BT /${bold ? "F2" : "F1"} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${esc(text)}) Tj ET`);
  }

  paragraph(text, size = 10.5, leading = 15, color = "#374151") {
    const lines = wrapText(text, contentWidth, size);
    for (const line of lines) {
      this.text(line, margin, this.y, size, false, color);
      this.y -= leading;
    }
    this.y -= 5;
  }

  heading(text) {
    this.y -= 12;
    this.text(text, margin, this.y, 17, true, "#111827");
    this.y -= 24;
    this.strokeColor("#d1d5db");
    this.lineWidth(1);
    this.line(margin, this.y + 11, pageWidth - margin, this.y + 11);
  }

  subheading(text) {
    this.y -= 8;
    this.text(text, margin, this.y, 13, true, "#111827");
    this.y -= 18;
  }

  bullet(text) {
    const lines = wrapText(text, contentWidth - 18, 10.2);
    this.text("-", margin, this.y, 10.2, true, "#111827");
    this.text(lines[0], margin + 18, this.y, 10.2, false, "#374151");
    this.y -= 14;
    for (let i = 1; i < lines.length; i++) {
      this.text(lines[i], margin + 18, this.y, 10.2, false, "#374151");
      this.y -= 14;
    }
  }

  note(text) {
    const y0 = this.y - 8;
    const lines = wrapText(text, contentWidth - 28, 10);
    const h = lines.length * 14 + 18;
    this.fillColor("#f8fafc");
    this.rect(margin, y0 - h + 10, contentWidth, h, true);
    this.strokeColor("#94a3b8");
    this.lineWidth(1);
    this.rect(margin, y0 - h + 10, contentWidth, h, false);
    let yy = y0 - 10;
    for (const line of lines) {
      this.text(line, margin + 14, yy, 10, false, "#334155");
      yy -= 14;
    }
    this.y = y0 - h - 4;
  }
}

function rgb(hex) {
  const s = hex.replace("#", "");
  return [0, 2, 4].map((i) => (parseInt(s.slice(i, i + 2), 16) / 255).toFixed(3));
}

function drawHeader(p, title, subtitle) {
  p.fillColor("#111827");
  p.rect(0, 0, pageWidth, pageHeight, true);
  p.fillColor("#f59e0b");
  p.rect(0, pageHeight - 170, pageWidth, 170, true);
  p.fillColor("#1f2937");
  p.rect(0, pageHeight - 174, pageWidth, 12, true);
  p.text(title, margin, pageHeight - 88, 33, true, "#111827");
  p.text(subtitle, margin, pageHeight - 116, 14, false, "#111827");
  p.text("A quick guide for hosts and players", margin, pageHeight - 143, 11, false, "#374151");

  drawTicket(p, margin, 355, contentWidth, 214);
  p.text("Sample ticket", margin, 325, 14, true, "#f9fafb");
  p.text("Mark only numbers that have been called. Correct claims add to your purse; bogey claims deduct from it.", margin, 303, 10.5, false, "#e5e7eb");
}

function drawTicket(p, x, y, w, h) {
  const compact = h < 140;
  p.fillColor("#fbbf24");
  p.rect(x, y, w, h, true);
  p.strokeColor("#92400e");
  p.lineWidth(2);
  p.rect(x, y, w, h, false);
  p.text("TAMBOLA TICKET", x + 12, y + h - 20, compact ? 9.5 : 14, true, "#111827");
  p.text("Player: Rahul", x + w - (compact ? 82 : 145), y + h - 20, compact ? 7.2 : 10.5, false, "#111827");

  const gridX = x + 12;
  const gridY = y + 12;
  const gridW = w - 24;
  const gridH = h - (compact ? 42 : 62);
  const cellW = gridW / 9;
  const cellH = gridH / 3;
  const nums = [
    [4, null, 22, null, 41, 55, null, 72, null],
    [null, 16, null, 34, null, 58, 63, null, 89],
    [8, 19, null, null, 47, null, 68, 76, null],
  ];
  const marked = new Set([4, 22, 55, 16, 89]);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 9; c++) {
      const xx = gridX + c * cellW;
      const yy = gridY + (2 - r) * cellH;
      const value = nums[r][c];
      p.fillColor(value == null ? "#fde68a" : marked.has(value) ? "#16a34a" : "#fff7ed");
      p.rect(xx, yy, cellW - 1, cellH - 1, true);
      p.strokeColor("#78350f");
      p.lineWidth(0.4);
      p.rect(xx, yy, cellW - 1, cellH - 1, false);
      if (value != null) {
        const numSize = Math.min(16, cellH * 0.58);
        p.text(String(value), xx + cellW / 2 - numSize * 0.35, yy + cellH / 2 - numSize * 0.32, numSize, true, marked.has(value) ? "#ffffff" : "#111827");
      }
    }
  }
}

function drawFlow(p, x, y, w) {
  const boxW = (w - 18) / 2;
  const boxH = 34;
  const titleSize = 8.8;
  const captionSize = 6.8;
  const labels = [
    ["Create room", "Host sets prizes"],
    ["Share code", "Players join"],
    ["Call numbers", "Mark tickets"],
    ["Claim prizes", "Leaderboard"],
  ];
  for (let i = 0; i < labels.length; i++) {
    const xx = x + (i % 2) * (boxW + 18);
    const yy = y + (i < 2 ? boxH + 14 : 0);
    p.fillColor(["#dbeafe", "#dcfce7", "#fef3c7", "#fee2e2"][i]);
    p.rect(xx, yy, boxW, boxH, true);
    p.strokeColor("#475569");
    p.lineWidth(1);
    p.rect(xx, yy, boxW, boxH, false);
    p.text(labels[i][0], xx + 7, yy + 19, titleSize, true, "#111827");
    p.text(labels[i][1], xx + 7, yy + 8, captionSize, false, "#374151");
    if (i < labels.length - 1) {
      const ax = i === 1 ? x + boxW / 2 : xx + boxW + 4;
      const ay = i === 1 ? yy - 6 : yy + boxH / 2;
      p.strokeColor("#475569");
      if (i === 1) {
        p.line(ax, ay + 4, ax, ay - 6);
        p.line(ax, ay - 6, ax - 4, ay - 1);
        p.line(ax, ay - 6, ax + 4, ay - 1);
      } else {
        p.line(ax, ay, ax + 10, ay);
        p.line(ax + 10, ay, ax + 5, ay + 4);
        p.line(ax + 10, ay, ax + 5, ay - 4);
      }
    }
  }
}

function drawCalledBoard(p, x, y, w, cols = 10, gap = 3) {
  const cell = (w - gap * (cols - 1)) / cols;
  const rows = Math.ceil(90 / cols);
  const textSize = Math.min(6.2, cell * 0.42);
  const called = new Set([4, 8, 16, 19, 22, 34, 41, 47, 55, 58, 63, 68, 72, 76, 89]);
  for (let i = 1; i <= 90; i++) {
    const c = (i - 1) % cols;
    const r = Math.floor((i - 1) / cols);
    const xx = x + c * (cell + gap);
    const yy = y + (rows - 1 - r) * (cell + gap);
    p.fillColor(called.has(i) ? "#f59e0b" : "#e5e7eb");
    p.rect(xx, yy, cell, cell, true);
    p.text(String(i), xx + (i < 10 ? cell * 0.36 : cell * 0.2), yy + cell * 0.34, textSize, true, called.has(i) ? "#111827" : "#6b7280");
  }
}

function drawClaimCards(p, x, y, w) {
  const cards = [
    ["Fast 5", "Any 5 called marks", "50"],
    ["Top", "Top row complete", "50"],
    ["Middle", "Middle row complete", "50"],
    ["Bottom", "Bottom row complete", "50"],
    ["Housie", "All 15 complete", "200"],
  ];
  const gap = 8;
  const cardW = (w - gap * 4) / 5;
  for (let i = 0; i < cards.length; i++) {
    const xx = x + i * (cardW + gap);
    p.fillColor(i === 4 ? "#111827" : "#f8fafc");
    p.rect(xx, y, cardW, 86, true);
    p.strokeColor("#cbd5e1");
    p.rect(xx, y, cardW, 86, false);
    p.text(cards[i][0], xx + 8, y + 60, 10.5, true, i === 4 ? "#f9fafb" : "#111827");
    for (const [lineIndex, line] of wrapText(cards[i][1], cardW - 16, 8.5).slice(0, 2).entries()) {
      p.text(line, xx + 8, y + 43 - lineIndex * 11, 8.5, false, i === 4 ? "#e5e7eb" : "#475569");
    }
    p.text(cards[i][2], xx + 8, y + 12, 13, true, i === 4 ? "#fbbf24" : "#b45309");
  }
}

function makePages() {
  const p = new Page();
  const section = (title, x, y, w, h, fill = "#ffffff") => {
    p.fillColor(fill);
    p.rect(x, y, w, h, true);
    p.strokeColor("#cbd5e1");
    p.lineWidth(0.8);
    p.rect(x, y, w, h, false);
    p.text(title, x + 10, y + h - 17, 10.5, true, "#111827");
  };
  const small = (text, x, y, w, size = 8.3, leading = 10.8, color = "#334155") => {
    const lines = wrapText(text, w, size);
    lines.forEach((line, i) => p.text(line, x, y - i * leading, size, false, color));
    return y - lines.length * leading;
  };
  const bulletAt = (items, x, y, w, size = 8, leading = 10.5) => {
    let yy = y;
    for (const item of items) {
      p.text("-", x, yy, size, true, "#111827");
      yy = small(item, x + 9, yy, w - 9, size, leading);
      yy -= 1.5;
    }
    return yy;
  };

  p.fillColor("#f8fafc");
  p.rect(0, 0, pageWidth, pageHeight, true);
  p.fillColor("#111827");
  p.rect(0, pageHeight - 66, pageWidth, 66, true);
  p.fillColor("#f59e0b");
  p.rect(0, pageHeight - 70, pageWidth, 5, true);
  p.text("GameHub User Manual", margin, pageHeight - 28, 23, true, "#ffffff");
  p.text("One-page guide for rooms, tickets, numbers, claims, scoring, and game end.", margin, pageHeight - 49, 10, false, "#e5e7eb");
  // p.text("Landscape layout for easy printing and sharing", pageWidth - 262, pageHeight - 31, 9.5, false, "#fbbf24");

  const topY = 326;
  section("Ticket + Marking", margin, topY, 330, 184, "#fff7ed");
  drawTicket(p, margin + 12, topY + 54, 306, 108);
  small("Ticket rules: 3 rows x 9 columns, 5 numbers per row, 15 total numbers. Columns follow Tambola ranges: 1-9, 10-19, ... 70-79, 80-90.", margin + 12, topY + 40, 306, 7.6, 9.5);
  bulletAt([
    "Tap/select a ticket number only after it has been called.",
    "Selecting an uncalled number is rejected; tap again to unmark.",
    "Keep marks accurate before claiming.",
  ], margin + 12, topY + 23, 306, 7.5, 9.2);

  section("Game Flow + Joining", margin + 346, topY, 224, 184, "#f0fdf4");
  drawFlow(p, margin + 358, topY + 81, 200);
  bulletAt([
    "Host creates a room, enters name, sets prize amounts, and chooses how many Housies are allowed.",
    "Host shares the 6-character room code.",
    "Players join with room code and display name; each gets a ticket.",
    "Ended rooms cannot be joined.",
  ], margin + 358, topY + 76, 200, 7.4, 9.4);

  section("Host + Numbers", margin + 586, topY, 225, 184, "#eff6ff");
  bulletAt([
    "Only the host can press Next Number.",
    "Numbers are randomly called from 1 to 90 and never repeat.",
    "The first number changes the room from waiting to playing.",
    "Everyone sees the last number, called count, and highlighted called numbers.",
  ], margin + 598, topY + 154, 201, 7.8, 10);
  p.fillColor("#ffffff");
  p.rect(margin + 598, topY + 14, 201, 64, true);
  p.strokeColor("#bfdbfe");
  p.rect(margin + 598, topY + 14, 201, 64, false);
  p.text("Last", margin + 612, topY + 56, 8, true, "#1e3a8a");
  p.fillColor("#f59e0b");
  p.rect(margin + 610, topY + 22, 38, 30, true);
  p.text("55", margin + 620, topY + 32, 15, true, "#111827");
  p.text("Called", margin + 668, topY + 56, 8, true, "#1e3a8a");
  p.text("15/90", margin + 668, topY + 34, 17, true, "#111827");
  p.fillColor("#111827");
  p.rect(margin + 735, topY + 22, 50, 30, true);
  p.text("Next", margin + 746, topY + 34, 12, true, "#ffffff");

  const claimY = 154;
  section("Prize Claims and Scoring", margin, claimY, contentWidth, 154, "#fefce8");
  drawClaimCards(p, margin + 12, claimY + 62, contentWidth - 24);
  p.text("Prize amounts shown are examples; actual values are set by the host.", margin + 12, claimY + 52, 7.2, false, "#854d0e");
  const leftX = margin + 10;
  const midX = margin + 278;
  const rightX = margin + 542;
  bulletAt([
    "Fastest Five: any 5 ticket numbers are called and marked.",
    "Top Line: all 5 top-row numbers are called and marked.",
    "Middle Line: all 5 middle-row numbers are called and marked.",
    "Bottom Line: all 5 bottom-row numbers are called and marked.",
    "Housie: all 15 ticket numbers are called and marked.",
  ], leftX, claimY + 39, 250, 7.2, 8.8);
  bulletAt([
    "Fastest Five and each line can be won once per room.",
    "Housie can have as many winners as the host allowed.",
    "Correct claim: prize amount is added to the purse.",
    "Bogey claim: incorrect/early claim deducts that prize amount.",
    "Prizes Claimed shows winners; Players shows current purse values.",
  ], midX, claimY + 39, 250, 7.2, 8.8);
  bulletAt([
    "Use Claim a prize only when your ticket qualifies.",
    "Incorrect claims show a Bogey message with the reason.",
    "The room creator also receives a ticket and can play.",
    "Current purse values update for all players.",
  ], rightX, claimY + 39, 245, 7.2, 8.8);

  const bottomY = 28;
  section("Called Board, Game End, Leaderboard, and Tips", margin, bottomY, contentWidth, 108, "#ffffff");
  drawCalledBoard(p, margin + 12, bottomY + 14, 210, 18, 1.6);
  p.text("Called board", margin + 242, bottomY + 74, 8.5, true, "#111827");
  small("Highlighted cells are numbers that have arrived.", margin + 242, bottomY + 59, 80, 7.1, 8.8);
  bulletAt([
    "The game ends automatically when the allowed number of Housie claims is reached.",
    "After the game ends, no more numbers are called and the leaderboard is shown.",
    "Leaderboard ranks players by purse from highest to lowest.",
    "Player tip: watch the last number and called board, mark immediately, and verify before claiming.",
    "Host tip: wait for expected players, share the code clearly, and call numbers at a steady pace.",
    "Use Exit to leave; leaving removes your player record and you lose access to that ticket.",
  ], margin + 342, bottomY + 82, 455, 7.5, 9.2);

  return [p];
}

function buildPdf(pages) {
  const objects = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  let next = 5;
  const pageIds = [];
  for (const page of pages) {
    const stream = page.ops.join("\n");
    const contentId = next++;
    const pageId = next++;
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    pageIds.push(pageId);
  }
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "utf8");
}

writeFileSync(outPath, buildPdf(makePages()));
console.log(outPath);
