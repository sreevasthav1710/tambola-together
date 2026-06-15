export const BOARD_SIZE = 10;
export const TOTAL_CELLS = 100;
export const START_CELL = 1;
export const FINISH_CELL = 100;
export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export const SNAKES: Record<number, number> = {
  99: 24,
  95: 75,
  89: 53,
  66: 56,
  59: 23,
  40: 20,
  19: 2,
  27: 15,
  6: 5,
};

export const LADDERS: Record<number, number> = {
  4: 74,
  8: 35,
  13: 46,
  33: 49,
  51: 67,
  62: 81,
  72: 91,
  77: 86,
};

export const PLAYER_COLORS = [
  "oklch(0.58 0.23 27)",
  "oklch(0.6 0.27 200)",
  "oklch(0.55 0.23 248)",
  "oklch(0.58 0.25 310)",
  "oklch(0.6 0.24 345)",
  "oklch(0.5 0.2 285)",
];

export type SnakeLadderEvent =
  | "create-room"
  | "join-room"
  | "start-game"
  | "roll-dice"
  | "move-player"
  | "snake-hit"
  | "ladder-hit"
  | "winner"
  | "turn-change"
  | "pause-game"
  | "resume-game"
  | "restart-game"
  | "leave-room";

export interface SnakeLadderPlayerState {
  id: string;
  name: string;
  position: number;
  color: string;
  finished: boolean;
  movePath: number[];
}

export interface SnakeLadderRoomState {
  currentTurnIndex: number;
  lastDice: number | null;
  winnerId: string | null;
  eventLog: {
    id: string;
    type: SnakeLadderEvent;
    message: string;
    playerId?: string;
    at: number;
  }[];
}

export interface MoveResult {
  from: number;
  dice: number;
  attempted: number;
  finalPosition: number;
  moved: boolean;
  snakeFrom?: number;
  ladderFrom?: number;
  winner: boolean;
}

export function createInitialRoomState(): SnakeLadderRoomState {
  return {
    currentTurnIndex: 0,
    lastDice: null,
    winnerId: null,
    eventLog: [],
  };
}

export function createPlayerState(
  id: string,
  name: string,
  index: number,
  color?: string,
): SnakeLadderPlayerState {
  return {
    id,
    name,
    position: START_CELL,
    color: color || PLAYER_COLORS[index % PLAYER_COLORS.length],
    finished: false,
    movePath: [START_CELL],
  };
}

export function normalizeRoomState(value: unknown): SnakeLadderRoomState {
  const state = (value && typeof value === "object" ? value : {}) as Partial<SnakeLadderRoomState>;
  return {
    currentTurnIndex: Number.isInteger(state.currentTurnIndex) ? Number(state.currentTurnIndex) : 0,
    lastDice: typeof state.lastDice === "number" ? state.lastDice : null,
    winnerId: typeof state.winnerId === "string" ? state.winnerId : null,
    eventLog: Array.isArray(state.eventLog) ? state.eventLog.slice(-12) : [],
  };
}

export function normalizePlayerState(
  value: unknown,
  id: string,
  name: string,
  index: number,
): SnakeLadderPlayerState {
  const state = (
    value && typeof value === "object" ? value : {}
  ) as Partial<SnakeLadderPlayerState>;
  return {
    id,
    name,
    position: clampCell(typeof state.position === "number" ? state.position : START_CELL),
    color:
      typeof state.color === "string" ? state.color : PLAYER_COLORS[index % PLAYER_COLORS.length],
    finished: Boolean(state.finished),
    movePath: Array.isArray(state.movePath)
      ? state.movePath
          .filter((cell): cell is number => typeof cell === "number")
          .map(clampCell)
      : [],
  };
}

export function rollDice(): number {
  return Math.floor(Math.random() * 6) + 1;
}

export function checkSnake(position: number): number | null {
  return SNAKES[position] ?? null;
}

export function checkLadder(position: number): number | null {
  return LADDERS[position] ?? null;
}

export function checkWinner(position: number): boolean {
  return position === FINISH_CELL;
}

export function movePlayer(player: SnakeLadderPlayerState, dice: number): MoveResult {
  const attempted = player.position + dice;

  if (attempted > FINISH_CELL) {
    return {
      from: player.position,
      dice,
      attempted,
      finalPosition: player.position,
      moved: false,
      winner: false,
    };
  }

  const snakeTail = checkSnake(attempted);
  if (snakeTail !== null) {
    return {
      from: player.position,
      dice,
      attempted,
      finalPosition: snakeTail,
      moved: true,
      snakeFrom: attempted,
      winner: checkWinner(snakeTail),
    };
  }

  const ladderTop = checkLadder(attempted);
  if (ladderTop !== null) {
    return {
      from: player.position,
      dice,
      attempted,
      finalPosition: ladderTop,
      moved: true,
      ladderFrom: attempted,
      winner: checkWinner(ladderTop),
    };
  }

  return {
    from: player.position,
    dice,
    attempted,
    finalPosition: attempted,
    moved: true,
    winner: checkWinner(attempted),
  };
}

export function movePathForResult(result: MoveResult): number[] {
  if (!result.moved) return [result.from];

  const path: number[] = [result.from];
  for (let cell = result.from + 1; cell <= result.attempted; cell++) {
    path.push(cell);
  }
  if (result.finalPosition !== result.attempted) {
    path.push(result.attempted);
    path.push(result.finalPosition);
  }
  return path;
}

export function nextTurn(currentTurnIndex: number, totalPlayers: number): number {
  if (totalPlayers <= 0) return 0;
  return (currentTurnIndex + 1) % totalPlayers;
}

export function restartGame(players: SnakeLadderPlayerState[]): {
  roomState: SnakeLadderRoomState;
  playerStates: SnakeLadderPlayerState[];
} {
  return {
    roomState: createInitialRoomState(),
    playerStates: players.map((player, index) => ({
      ...player,
      position: START_CELL,
      color: player.color || PLAYER_COLORS[index % PLAYER_COLORS.length],
      finished: false,
      movePath: [START_CELL],
    })),
  };
}

export function boardCells(): number[] {
  const cells: number[] = [];
  for (let row = BOARD_SIZE - 1; row >= 0; row--) {
    const rowStart = row * BOARD_SIZE + 1;
    const values = Array.from({ length: BOARD_SIZE }, (_, index) => rowStart + index);
    cells.push(...(row % 2 === 0 ? values : values.reverse()));
  }
  return cells;
}

export function appendEvent(
  state: SnakeLadderRoomState,
  type: SnakeLadderEvent,
  message: string,
  playerId?: string,
): SnakeLadderRoomState {
  return {
    ...state,
    eventLog: [
      ...state.eventLog.slice(-11),
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

function clampCell(value: number): number {
  if (!Number.isFinite(value)) return START_CELL;
  return Math.min(FINISH_CELL, Math.max(START_CELL, Math.round(value)));
}
