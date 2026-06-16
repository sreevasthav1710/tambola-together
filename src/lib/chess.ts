import { Chess as ChessEngine, validateFen, type Move, type Square } from "chess.js";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 2;
export const SIDES = ["white", "black"] as const;
export type ChessSide = (typeof SIDES)[number];

export type ChessEvent =
  | "create-room"
  | "join-room"
  | "start-game"
  | "move"
  | "checkmate"
  | "resign"
  | "draw"
  | "turn-change"
  | "pause-game"
  | "resume-game"
  | "restart-game"
  | "leave-room";

export interface ChessPlayerState {
  id: string;
  name: string;
  side: ChessSide | "spectator";
}

export interface ChessRoomState {
  // Standard FEN string for board position. Use starting position by default.
  fen: string;
  // index into players array who has the move
  currentTurnIndex: number;
  winnerId: string | null;
  lastMove: { from: Square; to: Square; san: string } | null;
  moveHistory: string[];
  eventLog: {
    id: string;
    type: ChessEvent;
    message: string;
    playerId?: string;
    at: number;
  }[];
}

export function createInitialRoomState(): ChessRoomState {
  return {
    fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    currentTurnIndex: 0,
    winnerId: null,
    lastMove: null,
    moveHistory: [],
    eventLog: [],
  };
}

export function createPlayerState(
  id: string,
  name: string,
  index: number,
  side?: ChessSide | "spectator",
): ChessPlayerState {
  const assignedSide = side ?? (index === 0 ? "white" : index === 1 ? "black" : "spectator");
  return { id, name, side: assignedSide };
}

export function normalizeRoomState(value: unknown): ChessRoomState {
  const state = (value && typeof value === "object" ? value : {}) as Partial<ChessRoomState>;
  const initial = createInitialRoomState();
  const fen = typeof state.fen === "string" && validateFen(state.fen).ok ? state.fen : initial.fen;
  const lastMove =
    state.lastMove &&
    typeof state.lastMove === "object" &&
    isSquare((state.lastMove as { from?: unknown }).from) &&
    isSquare((state.lastMove as { to?: unknown }).to) &&
    typeof (state.lastMove as { san?: unknown }).san === "string"
      ? {
          from: (state.lastMove as { from: Square }).from,
          to: (state.lastMove as { to: Square }).to,
          san: (state.lastMove as { san: string }).san,
        }
      : null;
  return {
    fen,
    currentTurnIndex: Number.isInteger(state.currentTurnIndex) ? Number(state.currentTurnIndex) : 0,
    winnerId: typeof state.winnerId === "string" ? state.winnerId : null,
    lastMove,
    moveHistory: Array.isArray(state.moveHistory)
      ? state.moveHistory.filter((move): move is string => typeof move === "string").slice(-80)
      : [],
    eventLog: Array.isArray(state.eventLog) ? state.eventLog.slice(-24) : [],
  };
}

export function normalizePlayerState(
  value: unknown,
  id: string,
  name: string,
  index: number,
): ChessPlayerState {
  const state = (value && typeof value === "object" ? value : {}) as Partial<ChessPlayerState>;
  return {
    id,
    name,
    side: state.side === "white" || state.side === "black" ? state.side : index === 0 ? "white" : index === 1 ? "black" : "spectator",
  };
}

export function createEngine(fen: string): ChessEngine {
  try {
    return new ChessEngine(fen);
  } catch {
    return new ChessEngine(createInitialRoomState().fen);
  }
}

export function turnSide(fen: string): ChessSide {
  return createEngine(fen).turn() === "w" ? "white" : "black";
}

export function legalMovesFor(fen: string, square: Square): Move[] {
  return createEngine(fen).moves({ square, verbose: true });
}

export function pieceAt(fen: string, square: Square) {
  return createEngine(fen).get(square);
}

export function makeMove(state: ChessRoomState, from: Square, to: Square): ChessRoomState | null {
  const engine = createEngine(state.fen);
  const piece = engine.get(from);
  const move = engine.move({
    from,
    to,
    promotion: piece?.type === "p" && (to.endsWith("8") || to.endsWith("1")) ? "q" : undefined,
  });
  if (!move) return null;

  const winnerSide = engine.isCheckmate() ? (move.color === "w" ? "white" : "black") : null;
  return {
    ...state,
    fen: engine.fen(),
    currentTurnIndex: engine.turn() === "w" ? 0 : 1,
    winnerId: winnerSide,
    lastMove: { from: move.from, to: move.to, san: move.san },
    moveHistory: [...state.moveHistory, move.san].slice(-80),
  };
}

export function statusText(state: ChessRoomState): string {
  const engine = createEngine(state.fen);
  if (engine.isCheckmate()) return "Checkmate";
  if (engine.isStalemate()) return "Stalemate";
  if (engine.isDraw()) return "Draw";
  if (engine.isCheck()) return "Check";
  return `${turnSide(state.fen)} to move`;
}

export function isGameOver(fen: string): boolean {
  return createEngine(fen).isGameOver();
}

export function appendEvent(
  state: ChessRoomState,
  type: ChessEvent,
  message: string,
  playerId?: string,
): ChessRoomState {
  return {
    ...state,
    eventLog: [
      ...state.eventLog.slice(-23),
      {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        message,
        playerId,
        at: Date.now(),
      },
    ],
  };
}

export function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/.test(value);
}
