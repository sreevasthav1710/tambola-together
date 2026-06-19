// Carrom physics + game state.
// Pure functions, deterministic. Used by both the client preview simulation
// and (if we ever add a server-side authoritative simulation) the server.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 4;

// Board dimensions in board-units. The rendered SVG scales 1:1 from these.
export const BOARD = 800;
export const PLAY_INSET = 60; // distance from board edge to wood cushion
export const PLAY_MIN = PLAY_INSET;
export const PLAY_MAX = BOARD - PLAY_INSET;
export const POCKET_RADIUS = 30;
export const COIN_RADIUS = 14;
export const STRIKER_RADIUS = 17;
export const CENTER = BOARD / 2;
export const CENTER_RING_RADIUS = 90;

// Friction per tick (~60 fps). Velocity *= FRICTION each step.
export const FRICTION = 0.985;
// Velocity threshold at which we consider an object stopped.
export const STOP_THRESHOLD = 0.08;
// Maximum simulation ticks before forced rest (safety net).
export const MAX_TICKS = 1200;
// Maximum striker launch speed (board-units per tick).
export const MAX_POWER = 22;

// The four baselines, indexed by player seat (0..3) clockwise.
// 0 = bottom (white1), 1 = right (black1), 2 = top (white2), 3 = left (black2).
export const SEATS = ["bottom", "right", "top", "left"] as const;
export type Seat = (typeof SEATS)[number];

export type Team = "white" | "black";

export const POCKETS: { x: number; y: number }[] = [
  { x: PLAY_MIN + 4, y: PLAY_MIN + 4 },
  { x: PLAY_MAX - 4, y: PLAY_MIN + 4 },
  { x: PLAY_MIN + 4, y: PLAY_MAX - 4 },
  { x: PLAY_MAX - 4, y: PLAY_MAX - 4 },
];

export type CoinType = "white" | "black" | "queen" | "striker";

export interface Coin {
  id: string;
  type: CoinType;
  x: number;
  y: number;
  vx: number;
  vy: number;
  pocketed: boolean;
  radius: number;
}

export interface CarromRoomState {
  coins: Coin[];
  // Map from player.id → team (computed once at start, persisted).
  teams: Record<string, Team>;
  // Per-team scored count.
  scores: { white: number; black: number };
  // Order of player ids that are seated (length = playerCount).
  turnOrder: string[];
  turnIndex: number;
  // Queen pocketed by team? Need to "cover" next turn.
  queenPocketedBy: Team | null;
  queenCovered: boolean;
  // Phase: aiming = current player aims & shoots; simulating = replaying last shot.
  phase: "aiming" | "simulating" | "ended";
  winner: Team | null;
  // Last shot (used by remote clients to replay the same animation).
  lastShot: {
    playerId: string;
    angle: number;
    power: number;
    strikerX: number;
    strikerY: number;
    seq: number;
  } | null;
  eventLog: { id: string; message: string; at: number }[];
  // Sequence counter so clients know when to re-run the simulation.
  shotSeq: number;
}

export function seatForIndex(i: number): Seat {
  return SEATS[i % 4];
}

export function teamForSeat(seat: Seat, playerCount: number): Team {
  if (playerCount <= 2) return seat === "bottom" ? "white" : "black";
  // 4 players: opposite seats are teammates. bottom + top = white, left + right = black.
  return seat === "bottom" || seat === "top" ? "white" : "black";
}

export function strikerBaseline(seat: Seat): { x?: number; y?: number; axis: "x" | "y"; min: number; max: number } {
  // Baseline is the line on which the striker may slide.
  const margin = 110;
  if (seat === "bottom") return { y: PLAY_MAX - 60, axis: "x", min: PLAY_MIN + margin, max: PLAY_MAX - margin };
  if (seat === "top") return { y: PLAY_MIN + 60, axis: "x", min: PLAY_MIN + margin, max: PLAY_MAX - margin };
  if (seat === "left") return { x: PLAY_MIN + 60, axis: "y", min: PLAY_MIN + margin, max: PLAY_MAX - margin };
  return { x: PLAY_MAX - 60, axis: "y", min: PLAY_MIN + margin, max: PLAY_MAX - margin };
}

export function initialCoinLayout(): Coin[] {
  // Standard carrom layout: 1 queen at center, 6 inner ring, 12 outer ring.
  const coins: Coin[] = [];
  coins.push({
    id: "queen",
    type: "queen",
    x: CENTER,
    y: CENTER,
    vx: 0,
    vy: 0,
    pocketed: false,
    radius: COIN_RADIUS,
  });
  // Inner ring of 6: alternating colors
  const r1 = COIN_RADIUS * 2 + 1;
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i) / 6 - Math.PI / 2;
    coins.push({
      id: `inner-${i}`,
      type: i % 2 === 0 ? "white" : "black",
      x: CENTER + Math.cos(a) * r1,
      y: CENTER + Math.sin(a) * r1,
      vx: 0,
      vy: 0,
      pocketed: false,
      radius: COIN_RADIUS,
    });
  }
  // Outer ring of 12: alternating, offset to nest
  const r2 = (COIN_RADIUS * 2 + 1) * 2;
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12 - Math.PI / 2 + Math.PI / 12;
    coins.push({
      id: `outer-${i}`,
      type: i % 2 === 0 ? "black" : "white",
      x: CENTER + Math.cos(a) * r2,
      y: CENTER + Math.sin(a) * r2,
      vx: 0,
      vy: 0,
      pocketed: false,
      radius: COIN_RADIUS,
    });
  }
  return coins;
}

export function createInitialRoomState(playerIds: string[]): CarromRoomState {
  const teams: Record<string, Team> = {};
  playerIds.forEach((id, i) => {
    teams[id] = teamForSeat(seatForIndex(i), playerIds.length);
  });
  return {
    coins: initialCoinLayout(),
    teams,
    scores: { white: 0, black: 0 },
    turnOrder: playerIds.slice(0, 4),
    turnIndex: 0,
    queenPocketedBy: null,
    queenCovered: false,
    phase: "aiming",
    winner: null,
    lastShot: null,
    eventLog: [],
    shotSeq: 0,
  };
}

export function normalizeRoomState(value: unknown): CarromRoomState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<CarromRoomState>;
  if (!Array.isArray(v.coins) || !v.turnOrder) return null;
  return {
    coins: v.coins as Coin[],
    teams: (v.teams as Record<string, Team>) ?? {},
    scores: v.scores ?? { white: 0, black: 0 },
    turnOrder: v.turnOrder as string[],
    turnIndex: Number(v.turnIndex ?? 0),
    queenPocketedBy: (v.queenPocketedBy as Team | null) ?? null,
    queenCovered: Boolean(v.queenCovered),
    phase: (v.phase as CarromRoomState["phase"]) ?? "aiming",
    winner: (v.winner as Team | null) ?? null,
    lastShot: v.lastShot ?? null,
    eventLog: Array.isArray(v.eventLog) ? v.eventLog.slice(-30) : [],
    shotSeq: Number(v.shotSeq ?? 0),
  };
}

// ============================================================================
// Physics
// ============================================================================

interface SimResult {
  finalCoins: Coin[];
  pocketed: { coinId: string; type: CoinType }[];
  frames: Coin[][]; // sampled every N ticks for animation
}

const FRAME_SAMPLE_EVERY = 2; // sample every 2 ticks => ~30fps animation data

// Step one tick of physics. Returns updated coins (in-place mutation).
function stepTick(coins: Coin[], pocketedOut: { coinId: string; type: CoinType }[]) {
  // 1. Move all non-pocketed coins.
  for (const c of coins) {
    if (c.pocketed) continue;
    c.x += c.vx;
    c.y += c.vy;
    // Apply friction.
    c.vx *= FRICTION;
    c.vy *= FRICTION;
    if (Math.abs(c.vx) < STOP_THRESHOLD) c.vx = 0;
    if (Math.abs(c.vy) < STOP_THRESHOLD) c.vy = 0;
  }
  // 2. Wall reflection.
  for (const c of coins) {
    if (c.pocketed) continue;
    const r = c.radius;
    if (c.x - r < PLAY_MIN) {
      c.x = PLAY_MIN + r;
      c.vx = -c.vx * 0.92;
    }
    if (c.x + r > PLAY_MAX) {
      c.x = PLAY_MAX - r;
      c.vx = -c.vx * 0.92;
    }
    if (c.y - r < PLAY_MIN) {
      c.y = PLAY_MIN + r;
      c.vy = -c.vy * 0.92;
    }
    if (c.y + r > PLAY_MAX) {
      c.y = PLAY_MAX - r;
      c.vy = -c.vy * 0.92;
    }
  }
  // 3. Coin-coin collisions (n^2; n is small).
  for (let i = 0; i < coins.length; i++) {
    const a = coins[i];
    if (a.pocketed) continue;
    for (let j = i + 1; j < coins.length; j++) {
      const b = coins[j];
      if (b.pocketed) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist2 = dx * dx + dy * dy;
      const rr = a.radius + b.radius;
      if (dist2 >= rr * rr || dist2 === 0) continue;
      const dist = Math.sqrt(dist2);
      const nx = dx / dist;
      const ny = dy / dist;
      // Separate overlap.
      const overlap = rr - dist;
      a.x -= nx * overlap * 0.5;
      a.y -= ny * overlap * 0.5;
      b.x += nx * overlap * 0.5;
      b.y += ny * overlap * 0.5;
      // Relative velocity along normal.
      const dvx = b.vx - a.vx;
      const dvy = b.vy - a.vy;
      const rel = dvx * nx + dvy * ny;
      if (rel >= 0) continue; // separating
      // Equal mass, perfectly elastic: swap normal components.
      const restitution = 0.96;
      const impulse = -(1 + restitution) * rel * 0.5;
      a.vx -= impulse * nx;
      a.vy -= impulse * ny;
      b.vx += impulse * nx;
      b.vy += impulse * ny;
    }
  }
  // 4. Pocket detection.
  for (const c of coins) {
    if (c.pocketed) continue;
    for (const p of POCKETS) {
      const dx = c.x - p.x;
      const dy = c.y - p.y;
      if (dx * dx + dy * dy < POCKET_RADIUS * POCKET_RADIUS) {
        c.pocketed = true;
        c.vx = 0;
        c.vy = 0;
        pocketedOut.push({ coinId: c.id, type: c.type });
        break;
      }
    }
  }
}

function allRest(coins: Coin[]): boolean {
  for (const c of coins) {
    if (c.pocketed) continue;
    if (Math.abs(c.vx) > 0 || Math.abs(c.vy) > 0) return false;
  }
  return true;
}

export function simulateShot(
  startCoins: Coin[],
  strikerX: number,
  strikerY: number,
  angle: number,
  power: number,
): SimResult {
  // Deep-clone coins.
  const coins: Coin[] = startCoins.map((c) => ({ ...c }));
  // Add striker.
  const striker: Coin = {
    id: "striker",
    type: "striker",
    x: strikerX,
    y: strikerY,
    vx: Math.cos(angle) * power,
    vy: Math.sin(angle) * power,
    pocketed: false,
    radius: STRIKER_RADIUS,
  };
  coins.push(striker);
  const pocketed: { coinId: string; type: CoinType }[] = [];
  const frames: Coin[][] = [coins.map((c) => ({ ...c }))];
  for (let t = 0; t < MAX_TICKS; t++) {
    stepTick(coins, pocketed);
    if (t % FRAME_SAMPLE_EVERY === 0) {
      frames.push(coins.map((c) => ({ ...c })));
    }
    if (allRest(coins)) break;
  }
  // Remove striker from final coins (always returns to box or is foul).
  const finalCoins = coins.filter((c) => c.id !== "striker");
  return { finalCoins, pocketed, frames };
}

// ============================================================================
// Game logic: apply a shot's pocketed coins and update scores/turn.
// ============================================================================

export interface ApplyShotResult {
  nextState: CarromRoomState;
  events: string[];
}

export function applyShot(
  state: CarromRoomState,
  shotPlayerId: string,
  pocketed: { coinId: string; type: CoinType }[],
  finalCoins: Coin[],
): ApplyShotResult {
  const events: string[] = [];
  const next: CarromRoomState = {
    ...state,
    coins: finalCoins,
    scores: { ...state.scores },
    eventLog: state.eventLog.slice(-20),
    shotSeq: state.shotSeq + 1,
  };
  const playerTeam = state.teams[shotPlayerId];
  const opponentTeam: Team = playerTeam === "white" ? "black" : "white";

  let foul = false;
  let pocketedOwn = 0;
  let pocketedOpp = 0;
  let pocketedQueen = false;
  let strikerPocketed = false;

  for (const p of pocketed) {
    if (p.type === "striker") strikerPocketed = true;
    else if (p.type === "queen") pocketedQueen = true;
    else if (p.type === playerTeam) {
      pocketedOwn++;
      next.scores[playerTeam] += 1;
    } else {
      pocketedOpp++;
      next.scores[opponentTeam] += 1;
    }
  }

  if (pocketedQueen) {
    next.queenPocketedBy = playerTeam;
    next.queenCovered = false;
    events.push(`${playerTeam} pocketed the Queen — must be covered`);
  }
  // Queen cover rule: if queen was pocketed in a previous turn (uncovered) and
  // this player is the same team AND pocketed at least one own coin this turn,
  // queen is covered.
  if (
    state.queenPocketedBy === playerTeam &&
    !state.queenCovered &&
    pocketedOwn > 0
  ) {
    next.queenCovered = true;
    events.push(`${playerTeam} covered the Queen`);
  }
  // If pocketed queen alone with no cover this turn, returns to center next shot.
  if (pocketedQueen && pocketedOwn === 0) {
    // Return queen to center for next turn.
    next.queenPocketedBy = null;
    const queen = next.coins.find((c) => c.id === "queen");
    if (queen) {
      queen.pocketed = false;
      queen.x = CENTER;
      queen.y = CENTER;
      queen.vx = 0;
      queen.vy = 0;
    }
    events.push(`Queen returned (no cover)`);
  }

  if (strikerPocketed) {
    foul = true;
    events.push(`Foul: striker pocketed`);
    // Return one of own pocketed coins to center, if any.
    if (next.scores[playerTeam] > 0) {
      next.scores[playerTeam] -= 1;
      // Place a "penalty" white/black coin back near center if room.
      // Simple: push a coin at a small offset from center.
      const offset = (next.coins.filter((c) => !c.pocketed).length % 7) * 6;
      next.coins.push({
        id: `penalty-${next.shotSeq}`,
        type: playerTeam,
        x: CENTER + offset,
        y: CENTER + offset,
        vx: 0,
        vy: 0,
        pocketed: false,
        radius: COIN_RADIUS,
      });
    }
  }

  if (pocketedOpp > 0) {
    foul = true;
    events.push(`Foul: opponent coin pocketed`);
  }

  for (const e of events) {
    next.eventLog.push({
      id: `${next.shotSeq}-${Math.random().toString(16).slice(2, 7)}`,
      message: e,
      at: Date.now(),
    });
  }

  // Win check.
  const whiteLeft = next.coins.filter((c) => !c.pocketed && c.type === "white").length;
  const blackLeft = next.coins.filter((c) => !c.pocketed && c.type === "black").length;
  if (whiteLeft === 0 && next.queenCovered && next.queenPocketedBy === "white") {
    next.winner = "white";
    next.phase = "ended";
  } else if (blackLeft === 0 && next.queenCovered && next.queenPocketedBy === "black") {
    next.winner = "black";
    next.phase = "ended";
  } else if (whiteLeft === 0 && next.queenPocketedBy !== "white") {
    next.winner = "white";
    next.phase = "ended";
  } else if (blackLeft === 0 && next.queenPocketedBy !== "black") {
    next.winner = "black";
    next.phase = "ended";
  }

  // Turn rotation: keep turn if own coin pocketed and no foul; else next.
  if (next.winner === null) {
    if (pocketedOwn > 0 && !foul) {
      // Same player shoots again.
    } else {
      next.turnIndex = (state.turnIndex + 1) % state.turnOrder.length;
    }
    next.phase = "aiming";
  }

  return { nextState: next, events };
}
