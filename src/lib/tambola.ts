// Tambola/Housie ticket generation and validation.
// A ticket is a 3 x 9 grid. Each row has exactly 5 numbers and 4 blanks.
// Column j (0..8) contains numbers in range: col 0 = 1-9, col 1..7 = 10-19..70-79, col 8 = 80-90.

export type Ticket = (number | null)[][]; // 3 rows x 9 cols

function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function colRange(col: number): [number, number] {
  if (col === 0) return [1, 9];
  if (col === 8) return [80, 90];
  return [col * 10, col * 10 + 9];
}

export function generateTicket(): Ticket {
  // Loop until we get a valid ticket (rare regeneration).
  for (let attempt = 0; attempt < 100; attempt++) {
    // Step 1: choose how many numbers per column. Total = 15, each col 1..3, each row = 5.
    // Use classic approach: start with 1 per column (9 numbers), distribute remaining 6.
    const colCounts = Array(9).fill(1);
    let remaining = 6;
    while (remaining > 0) {
      const c = Math.floor(Math.random() * 9);
      if (colCounts[c] < 3) {
        colCounts[c]++;
        remaining--;
      }
    }

    // Step 2: assign rows to each column's slots so each row totals 5.
    const grid: (number | null)[][] = [
      Array(9).fill(null),
      Array(9).fill(null),
      Array(9).fill(null),
    ];
    const rowCounts = [0, 0, 0];

    // For each column, pick which rows get filled.
    // Process columns with most numbers first to avoid getting stuck.
    const colsByCount = Array.from({ length: 9 }, (_, i) => i).sort(
      (a, b) => colCounts[b] - colCounts[a],
    );

    let ok = true;
    for (const col of colsByCount) {
      const need = colCounts[col];
      // Eligible rows: those with rowCounts < 5.
      const eligible = [0, 1, 2].filter((r) => rowCounts[r] < 5);
      if (eligible.length < need) {
        ok = false;
        break;
      }
      // Pick rows with most remaining capacity first to balance.
      const picked = eligible
        .sort((a, b) => 5 - rowCounts[a] - (5 - rowCounts[b]))
        .slice(0, need);
      // But add some randomness — shuffle eligible if multiple equal.
      const shuffledPick = shuffle(eligible).slice(0, need);
      // Use a balanced pick: prefer rows with capacity.
      const finalPick =
        Math.max(...picked.map((r) => 5 - rowCounts[r])) > 2 ? picked : shuffledPick;
      for (const r of finalPick) {
        grid[r][col] = -1; // marker
        rowCounts[r]++;
      }
    }
    if (!ok) continue;
    if (rowCounts.some((c) => c !== 5)) continue;

    // Step 3: fill numbers per column, sorted ascending top to bottom.
    for (let col = 0; col < 9; col++) {
      const [lo, hi] = colRange(col);
      const pool: number[] = [];
      for (let n = lo; n <= hi; n++) pool.push(n);
      const filledRows = [0, 1, 2].filter((r) => grid[r][col] === -1);
      const picked = shuffle(pool).slice(0, filledRows.length).sort((a, b) => a - b);
      filledRows.forEach((r, i) => {
        grid[r][col] = picked[i];
      });
    }

    return grid;
  }
  throw new Error("Failed to generate ticket");
}

export function ticketNumbers(ticket: Ticket): number[] {
  return ticket.flat().filter((n): n is number => typeof n === "number");
}

export function generateRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

// Validation helpers — given the ticket and the set of called numbers + the player's marked set.
function rowNumbers(ticket: Ticket, row: number): number[] {
  return ticket[row].filter((n): n is number => typeof n === "number");
}

export type ClaimType = "ff" | "line1" | "line2" | "line3" | "housie";

export function validateClaim(
  type: ClaimType,
  ticket: Ticket,
  called: number[],
  marked: number[],
): { ok: boolean; reason?: string } {
  const calledSet = new Set(called);
  const markedSet = new Set(marked);

  // every marked must have been called
  for (const m of marked) {
    if (!calledSet.has(m)) return { ok: false, reason: "Marked an uncalled number" };
  }

  if (type === "ff") {
    // exactly 5 marked numbers (or at least 5) that are all on ticket and called
    const onTicket = new Set(ticketNumbers(ticket));
    const validMarks = marked.filter((m) => onTicket.has(m));
    if (validMarks.length < 5) return { ok: false, reason: "Need 5 marked numbers" };
    return { ok: true };
  }

  const rowIdx = type === "line1" ? 0 : type === "line2" ? 1 : type === "line3" ? 2 : -1;
  if (rowIdx >= 0) {
    const nums = rowNumbers(ticket, rowIdx);
    for (const n of nums) {
      if (!calledSet.has(n)) return { ok: false, reason: "Row not fully called yet" };
      if (!markedSet.has(n)) return { ok: false, reason: "Row not fully marked" };
    }
    return { ok: true };
  }

  if (type === "housie") {
    const nums = ticketNumbers(ticket);
    for (const n of nums) {
      if (!calledSet.has(n)) return { ok: false, reason: "Ticket not fully called yet" };
      if (!markedSet.has(n)) return { ok: false, reason: "Ticket not fully marked" };
    }
    return { ok: true };
  }

  return { ok: false, reason: "Unknown claim" };
}

export const CLAIM_LABELS: Record<ClaimType, string> = {
  ff: "Fastest Five",
  line1: "Top Line",
  line2: "Middle Line",
  line3: "Bottom Line",
  housie: "Housie",
};
