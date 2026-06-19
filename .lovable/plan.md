# Plan

Three workstreams, in order. Carrom is last per your earlier instruction.

---

## 1. Chess alert fix (small)

The current `.chess-alert` is an absolutely-positioned overlay centered on the board — that's what's covering the pieces during Check / Checkmate.

- Remove the `alert` prop / overlay from `ChessBoard`.
- Render a banner ABOVE the board inside the Chess card:
  - **Check** — amber pill banner, auto-dismiss after 2.5s, re-appears if the new position is still check.
  - **Checkmate** — red banner that stays + a dismissable modal ("Game Over — {Winner} wins") with "New Game" (host only) and "Exit" buttons. Modal can be closed; the banner remains so the result is visible.
- Add a small "Check!" badge in the board corner only when the king is in check (non-blocking, ~24px pill).
- Verify with Playwright: scripted moves that produce check and checkmate, screenshot the board to confirm no pieces are covered.

## 2. Spectator mode (all 4 games)

### Database

One migration:
- `ALTER TABLE players ADD COLUMN role text NOT NULL DEFAULT 'player' CHECK (role IN ('player','spectator'))`.
- Update `claim_prize` and any future player-count queries to filter `role = 'player'`.

### Join flow (`src/routes/index.tsx`)

- Add a `Player / Spectator` segmented toggle on the Join Room dialog (default: Player).
- Spectators:
  - Don't get a Tambola ticket / chess side / snake-ladder pawn.
  - Don't count toward `MAX_PLAYERS` checks.
  - Can join at any time, including after the game has started.
- Create Room remains player-only (host is always a player).

### Per-game spectator UI (`src/routes/room.$roomId.tsx`)

Reuse the existing room views, branch on `me.role === 'spectator'`:

- **Tambola** — show all players' tickets in a scrollable grid (read-only, with marked numbers visualised), called-number board, leaderboard, and host controls hidden. Add a small "Spectating" badge in the header.
- **Snake & Ladder** — full board with all player pucks, current turn indicator, last dice roll animation, event log. No "Roll" button.
- **Chess** — board (white-orientation), move history, turn indicator, check/checkmate banner. No piece interaction.
- **Carrom** — board, all players' coins, current striker, power/aim of active player (read-only), score panel.

Spectator count shown in header for everyone (`3 players · 2 watching`).

Exit button works the same (double-confirm).

## 3. Carrom (4-player, physics-based)

### Game model (`src/lib/carrom.ts`)

- Constants: board 800×800 units, pocket radius 32, coin radius 14, striker radius 17, friction μ=0.985 per tick (i.e. velocity *= 0.985), tick rate 60Hz, min-velocity stop threshold.
- 19 coins: 9 white, 9 black, 1 red queen, arranged in the standard hex pattern at center.
- 4 sides: bottom, top, left, right. Each player shoots from their side's baseline.
- Team mapping (4 players): bottom+top = white team, left+right = black team. (Same as standard 4-player doubles carrom.) With 2 players: bottom=white, top=black.
- State stored in `rooms.game_state` as `{ coins: [{id,x,y,vx,vy,type,pocketed}], scores, turnIndex, queenPocketedBy, queenCovered, lastShot, phase: 'aiming'|'simulating'|'between' }`.

### Physics engine

Pure JS, deterministic, frame-stepped client-side simulation, then the final resting state is written to DB:

1. Active player aims (angle θ) and sets power P via drag-and-release on their striker.
2. Client runs the simulation locally (60 fps) until all coins rest (`|v| < 0.05` for all).
3. Server function `submit_shot` receives `{ angle, power, strikerX }`, re-simulates server-side (same code, ported), and writes resulting board + scores + next turn atomically. This prevents cheating and resyncs all clients.
4. Spectators / other players see the simulation replay client-side from `lastShot` (angle/power/strikerX) so the animation is identical everywhere.

Algorithms used (per your spec):
- Newton motion + friction `v *= μ` each tick.
- Circle–circle collision: when `d ≤ r1+r2`, resolve along normal with elastic collision (equal masses → swap normal components).
- Wall reflection: invert vx/vy when crossing cushion bounds.
- Pocket detection: coin center within pocket radius → remove from board and credit score.
- Foul handling: striker pocketed → −1 own coin returned to center (penalty), turn ends. Pocket opponent's coin → turn ends, no score. Queen rule: must pocket queen + cover (next legal pocket of own coin in same or next turn) else queen returns.

### UI (`src/routes/room.$roomId.tsx` — new CarromRoom)

- Wooden board with 4 corner pockets, center circle, arrow markers.
- Active player's striker is draggable along their baseline; on press, a power meter + aim line appears; release fires.
- Aim guide: white line from striker to first wall/coin reflection only (per your spec).
- Score panel: each team's coin count, queen status (uncovered/covered/won).
- Sidebar: turn order, scores, event log ("X pocketed Queen", "Y fouled — coin returned").
- Mobile-friendly: touch-drag for aim, pinch to nothing (board scales to viewport).

### Spectator view for carrom
Read-only board + live simulation playback. No striker controls.

### Game selection
Add `carrom` to `GAME_META` in `src/routes/index.tsx` with min=2, max=4 players. Create Room dialog adds team-size selector (1v1 / 2v2).

---

## Technical details

- Migration runs first (adds `players.role`), then types regenerate, then code.
- All realtime sync stays on the existing channel subscription + 2.5s polling fallback already in place.
- The physics tick functions live in `src/lib/carrom.ts` so both client preview and server-fn validation use identical math.
- Server-side shot validation uses a `createServerFn` (`submit_carrom_shot`) using `requireSupabaseAuth`-less RPC, similar to the existing `claim_prize` Postgres function (we'll use plpgsql for atomic state swap, but the simulation itself runs in TS in a server function because plpgsql isn't a good fit for a physics loop). Concurrency is guarded by checking `turnIndex` and `phase` in the update WHERE clause.
- Estimated changes: ~250 lines for chess fix + spectator, ~900 lines for carrom (lib + UI + server fn). One DB migration.

I'll implement in order: (1) chess banner fix and verify, (2) spectator mode + migration, (3) carrom.
