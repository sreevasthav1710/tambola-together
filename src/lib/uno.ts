// UNO game engine.
// Pure functions, deterministic given inputs. All game state lives in
// rooms.game_state as UnoRoomState and mutates via the reducers below.

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 10;
export const INITIAL_HAND = 7;

export type UnoColor = "red" | "yellow" | "green" | "blue";
export type UnoValue =
  | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9"
  | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export interface UnoCard {
  id: string;
  color: UnoColor | "wild";
  value: UnoValue;
}

export interface UnoEvent {
  id: string;
  message: string;
  at: number;
}

export interface UnoRoomState {
  deck: UnoCard[];               // face-down draw pile (index 0 = top)
  discard: UnoCard[];            // face-up pile, last element = top
  hands: Record<string, UnoCard[]>;
  turnOrder: string[];
  turnIndex: number;
  direction: 1 | -1;
  currentColor: UnoColor;        // active color (matches discard, or chosen after wild)
  pendingDraw: number;           // stacked draw amount (0 when none)
  pendingType: "draw2" | "draw4" | null;
  awaitingColor: string | null;  // player id who must pick a color for a wild they just played
  unoCalled: Record<string, boolean>;
  winners: string[];
  winnersNeeded: number;
  phase: "waiting" | "playing" | "roundOver" | "ended";
  eventLog: UnoEvent[];
  seq: number;
  lastPlay: { playerId: string; card: UnoCard; at: number } | null;
}

const COLORS: UnoColor[] = ["red", "yellow", "green", "blue"];

function makeCard(color: UnoColor | "wild", value: UnoValue, tag: string): UnoCard {
  return { id: `${color}-${value}-${tag}`, color, value };
}

export function buildDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  for (const c of COLORS) {
    deck.push(makeCard(c, "0", "a"));
    for (let n = 1; n <= 9; n++) {
      deck.push(makeCard(c, String(n) as UnoValue, "a"));
      deck.push(makeCard(c, String(n) as UnoValue, "b"));
    }
    for (const v of ["skip", "reverse", "draw2"] as UnoValue[]) {
      deck.push(makeCard(c, v, "a"));
      deck.push(makeCard(c, v, "b"));
    }
  }
  for (let i = 0; i < 4; i++) {
    deck.push(makeCard("wild", "wild", `w${i}`));
    deck.push(makeCard("wild", "wild4", `w${i}`));
  }
  // Add uniqueness suffix
  return deck.map((c, i) => ({ ...c, id: `${c.id}-${i}` }));
}

export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createInitialRoomState(winnersNeeded = 1): UnoRoomState {
  return {
    deck: [],
    discard: [],
    hands: {},
    turnOrder: [],
    turnIndex: 0,
    direction: 1,
    currentColor: "red",
    pendingDraw: 0,
    pendingType: null,
    awaitingColor: null,
    unoCalled: {},
    winners: [],
    winnersNeeded: Math.max(1, winnersNeeded),
    phase: "waiting",
    eventLog: [],
    seq: 0,
    lastPlay: null,
  };
}

function nowId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function pushEvent(state: UnoRoomState, message: string) {
  state.eventLog = [
    ...state.eventLog.slice(-40),
    { id: nowId(), message, at: Date.now() },
  ];
}

/** Draw n cards from deck, reshuffling discard when needed. */
export function drawCards(state: UnoRoomState, n: number): UnoCard[] {
  const drawn: UnoCard[] = [];
  for (let i = 0; i < n; i++) {
    if (state.deck.length === 0) {
      // Reshuffle: keep top of discard, shuffle the rest back into deck.
      if (state.discard.length <= 1) break;
      const top = state.discard[state.discard.length - 1];
      const rest = state.discard.slice(0, -1).map((c) =>
        // Reset wild color back to wild so it can be replayed as wild.
        c.value === "wild" || c.value === "wild4" ? { ...c, color: "wild" as const } : c,
      );
      state.deck = shuffle(rest);
      state.discard = [top];
    }
    const c = state.deck.shift();
    if (!c) break;
    drawn.push(c);
  }
  return drawn;
}

/** Set up a fresh round given seated player ids. */
export function startRound(
  playerIds: string[],
  winnersNeeded: number,
  keepWinners: string[] = [],
): UnoRoomState {
  const state = createInitialRoomState(winnersNeeded);
  state.turnOrder = playerIds.slice();
  state.deck = shuffle(buildDeck());
  state.phase = "playing";
  state.winners = keepWinners.slice();

  for (const pid of playerIds) {
    state.hands[pid] = [];
  }
  for (let i = 0; i < INITIAL_HAND; i++) {
    for (const pid of playerIds) {
      const [c] = drawCards(state, 1);
      if (c) state.hands[pid].push(c);
    }
  }
  // Flip first card. Rules: if wild4, reshuffle and try again. If wild, first
  // player picks a color (we'll auto-pick red for the first flip to keep it
  // simple and deterministic). If action card, apply its effect to first
  // player.
  let first = drawCards(state, 1)[0];
  let guard = 0;
  while (first && first.value === "wild4" && guard++ < 20) {
    // Put back and shuffle
    state.deck.push(first);
    state.deck = shuffle(state.deck);
    first = drawCards(state, 1)[0];
  }
  if (!first) throw new Error("Failed to deal opening card");

  state.discard = [first];
  state.currentColor = first.color === "wild" ? "red" : first.color;
  state.turnIndex = 0;

  if (first.value === "skip") {
    pushEvent(state, `${nameOrId(playerIds[0])} skipped by opening card`);
    state.turnIndex = advanceIndex(state, 1);
  } else if (first.value === "reverse") {
    state.direction = -1;
    if (playerIds.length === 2) state.turnIndex = advanceIndex(state, 1);
  } else if (first.value === "draw2") {
    state.pendingDraw = 2;
    state.pendingType = "draw2";
  } else if (first.value === "wild") {
    state.awaitingColor = playerIds[0];
  }

  pushEvent(state, "Round started");
  state.seq = 1;
  state.lastPlay = null;
  return state;
}

function nameOrId(id: string) {
  return id.slice(0, 6);
}

function advanceIndex(state: UnoRoomState, steps: number) {
  const n = state.turnOrder.length;
  if (n === 0) return 0;
  let idx = state.turnIndex;
  const dir = state.direction;
  let moved = 0;
  while (moved < steps) {
    idx = (idx + dir + n) % n;
    // Skip finished winners
    if (!state.winners.includes(state.turnOrder[idx])) moved++;
  }
  return idx;
}

/** Check if `card` is legal to play on top of the current discard. */
export function isPlayable(card: UnoCard, state: UnoRoomState): boolean {
  const top = state.discard[state.discard.length - 1];
  if (!top) return true;
  // Pending stacked draws: only same-type stacking allowed.
  if (state.pendingDraw > 0) {
    if (state.pendingType === "draw2" && card.value === "draw2") return true;
    if (state.pendingType === "draw4" && card.value === "wild4") return true;
    return false;
  }
  if (state.awaitingColor) return false;
  if (card.color === "wild") return true;
  if (card.color === state.currentColor) return true;
  if (card.value === top.value) return true;
  return false;
}

export function currentPlayerId(state: UnoRoomState): string | null {
  return state.turnOrder[state.turnIndex] ?? null;
}

/** Play a card from playerId's hand. Returns a new state or throws. */
export function playCard(
  state: UnoRoomState,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor,
  playerNames?: Record<string, string>,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);

  if (s.phase !== "playing") throw new Error("Round not in play");
  if (s.awaitingColor && s.awaitingColor !== playerId) {
    throw new Error("Waiting for previous player to pick a color");
  }
  if (currentPlayerId(s) !== playerId) throw new Error("Not your turn");

  const hand = s.hands[playerId] ?? [];
  const idx = hand.findIndex((c) => c.id === cardId);
  if (idx < 0) throw new Error("Card not in hand");
  const card = hand[idx];
  if (!isPlayable(card, s)) throw new Error("Card is not playable");

  // If it's a wild, chosen color required.
  const isWild = card.color === "wild";
  if (isWild && !chosenColor) throw new Error("Choose a color for the wild");

  // Remove from hand, push to discard.
  hand.splice(idx, 1);
  s.hands[playerId] = hand;
  // For wilds, tag the card with chosen color on the discard for display.
  const played: UnoCard = isWild && chosenColor
    ? { ...card, color: chosenColor }
    : card;
  s.discard.push(played);
  s.currentColor = isWild && chosenColor ? chosenColor : (card.color as UnoColor);
  s.lastPlay = { playerId, card: played, at: Date.now() };

  pushEvent(s, `${nameOf(playerId)} played ${describeCard(played)}`);

  // If they now hold exactly 1 card, they must call UNO. Track flag.
  if (hand.length === 1 && !s.unoCalled[playerId]) {
    // The player can still call before the next action; we just mark that
    // they haven't called yet. UI shows the UNO button. If the next player
    // plays before this one calls, we auto-penalize elsewhere.
  }
  if (hand.length > 1) {
    s.unoCalled[playerId] = false;
  }

  // Empty hand → winner.
  if (hand.length === 0) {
    s.winners.push(playerId);
    s.unoCalled[playerId] = true;
    pushEvent(s, `🏆 ${nameOf(playerId)} finished!`);
    const remaining = s.turnOrder.filter((id) => !s.winners.includes(id));
    if (s.winners.length >= s.winnersNeeded || remaining.length <= 1) {
      if (remaining.length === 1) {
        pushEvent(s, `${nameOf(remaining[0])} is the last one holding cards`);
      }
      s.phase = "ended";
      s.seq += 1;
      return s;
    }
  }

  // Apply card effects.
  const n = s.turnOrder.length;
  if (card.value === "reverse") {
    s.direction = (s.direction === 1 ? -1 : 1) as 1 | -1;
    if (n - s.winners.length === 2) {
      // Acts like a skip in 2-player scenarios.
      s.turnIndex = advanceIndex(s, 2);
    } else {
      s.turnIndex = advanceIndex(s, 1);
    }
  } else if (card.value === "skip") {
    s.turnIndex = advanceIndex(s, 2);
  } else if (card.value === "draw2") {
    s.pendingDraw += 2;
    s.pendingType = "draw2";
    s.turnIndex = advanceIndex(s, 1);
  } else if (card.value === "wild4") {
    s.pendingDraw += 4;
    s.pendingType = "draw4";
    s.turnIndex = advanceIndex(s, 1);
  } else if (isWild) {
    s.turnIndex = advanceIndex(s, 1);
  } else {
    s.turnIndex = advanceIndex(s, 1);
  }

  s.awaitingColor = null;
  s.seq += 1;
  return s;
}

/** Draw the pending stacked cards (player couldn't or wouldn't stack). */
export function takePendingDraw(
  state: UnoRoomState,
  playerId: string,
  playerNames?: Record<string, string>,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);
  if (currentPlayerId(s) !== playerId) throw new Error("Not your turn");
  if (s.pendingDraw <= 0) throw new Error("Nothing to draw");
  const cards = drawCards(s, s.pendingDraw);
  s.hands[playerId] = [...(s.hands[playerId] ?? []), ...cards];
  pushEvent(s, `${nameOf(playerId)} drew ${cards.length} cards`);
  s.pendingDraw = 0;
  s.pendingType = null;
  s.turnIndex = advanceIndex(s, 1);
  s.seq += 1;
  return s;
}

/** Voluntarily draw one card. If it's playable the player may play it right
 *  away (we return a state with a "drawnPlayable" hint via lastPlay=null and
 *  the caller can check the last card of the hand). */
export function drawOne(
  state: UnoRoomState,
  playerId: string,
  playerNames?: Record<string, string>,
): { state: UnoRoomState; card: UnoCard | null; playable: boolean } {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);
  if (currentPlayerId(s) !== playerId) throw new Error("Not your turn");
  if (s.pendingDraw > 0) throw new Error("You must resolve the pending draw first");
  if (s.awaitingColor) throw new Error("Waiting for color choice");
  const [card] = drawCards(s, 1);
  if (!card) {
    // Deck & discard both exhausted — just skip.
    pushEvent(s, `${nameOf(playerId)} passes (no cards left in deck)`);
    s.turnIndex = advanceIndex(s, 1);
    s.seq += 1;
    return { state: s, card: null, playable: false };
  }
  s.hands[playerId] = [...(s.hands[playerId] ?? []), card];
  pushEvent(s, `${nameOf(playerId)} drew a card`);
  const playable = isPlayable(card, s);
  if (!playable) {
    s.turnIndex = advanceIndex(s, 1);
  }
  // If playable, leave turn on this player so they can play or pass.
  s.seq += 1;
  return { state: s, card, playable };
}

/** After drawing one and it's playable, player can pass instead. */
export function passAfterDraw(
  state: UnoRoomState,
  playerId: string,
  playerNames?: Record<string, string>,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);
  if (currentPlayerId(s) !== playerId) throw new Error("Not your turn");
  pushEvent(s, `${nameOf(playerId)} passed`);
  s.turnIndex = advanceIndex(s, 1);
  s.seq += 1;
  return s;
}

export function callUno(
  state: UnoRoomState,
  playerId: string,
  playerNames?: Record<string, string>,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);
  const hand = s.hands[playerId] ?? [];
  if (hand.length > 2) throw new Error("Too many cards to call UNO");
  s.unoCalled[playerId] = true;
  pushEvent(s, `${nameOf(playerId)} called UNO!`);
  s.seq += 1;
  return s;
}

/** Catch a player who forgot to call UNO (they have 1 card and didn't call).
 *  Caught player draws 2 cards as penalty. */
export function catchUno(
  state: UnoRoomState,
  targetId: string,
  callerId: string,
  playerNames?: Record<string, string>,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  const nameOf = (id: string) => playerNames?.[id] ?? nameOrId(id);
  const hand = s.hands[targetId] ?? [];
  if (hand.length !== 1) throw new Error("Target isn't on UNO");
  if (s.unoCalled[targetId]) throw new Error("Target already called UNO");
  const cards = drawCards(s, 2);
  s.hands[targetId] = [...hand, ...cards];
  s.unoCalled[targetId] = true;
  pushEvent(s, `${nameOf(callerId)} caught ${nameOf(targetId)} — +2 cards!`);
  s.seq += 1;
  return s;
}

export function chooseColor(
  state: UnoRoomState,
  playerId: string,
  color: UnoColor,
): UnoRoomState {
  const s: UnoRoomState = structuredClone(state);
  if (s.awaitingColor !== playerId) throw new Error("Not waiting on your color");
  s.currentColor = color;
  s.awaitingColor = null;
  pushEvent(s, `Color set to ${color}`);
  s.seq += 1;
  return s;
}

export function describeCard(card: UnoCard): string {
  const c = card.color === "wild" ? "Wild" : cap(card.color);
  const v = ({
    "0": "0","1": "1","2": "2","3": "3","4": "4","5": "5","6": "6","7": "7","8": "8","9": "9",
    skip: "Skip", reverse: "Reverse", draw2: "+2", wild: "", wild4: "+4",
  } as Record<UnoValue, string>)[card.value];
  return v ? `${c} ${v}`.trim() : c;
}

function cap(s: string) { return s[0].toUpperCase() + s.slice(1); }

export function colorHex(color: UnoColor | "wild"): string {
  switch (color) {
    case "red": return "#ef4444";
    case "yellow": return "#facc15";
    case "green": return "#22c55e";
    case "blue": return "#3b82f6";
    case "wild": return "#111827";
  }
}

export function normalizeRoomState(value: unknown): UnoRoomState | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<UnoRoomState>;
  if (!Array.isArray(v.turnOrder) || !v.hands) return null;
  return {
    deck: Array.isArray(v.deck) ? v.deck : [],
    discard: Array.isArray(v.discard) ? v.discard : [],
    hands: v.hands as Record<string, UnoCard[]>,
    turnOrder: v.turnOrder,
    turnIndex: v.turnIndex ?? 0,
    direction: (v.direction === -1 ? -1 : 1) as 1 | -1,
    currentColor: (v.currentColor ?? "red") as UnoColor,
    pendingDraw: v.pendingDraw ?? 0,
    pendingType: v.pendingType ?? null,
    awaitingColor: v.awaitingColor ?? null,
    unoCalled: v.unoCalled ?? {},
    winners: Array.isArray(v.winners) ? v.winners : [],
    winnersNeeded: v.winnersNeeded ?? 1,
    phase: (v.phase ?? "waiting") as UnoRoomState["phase"],
    eventLog: Array.isArray(v.eventLog) ? v.eventLog : [],
    seq: v.seq ?? 0,
    lastPlay: v.lastPlay ?? null,
  };
}
