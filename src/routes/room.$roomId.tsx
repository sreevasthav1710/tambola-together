import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback, type CSSProperties } from "react";
import type { Square } from "chess.js";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getIdentity, clearIdentity } from "@/lib/playerStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TambolaTicket } from "@/components/TambolaTicket";
import { validateClaim, CLAIM_LABELS, type ClaimType, type Ticket } from "@/lib/tambola";
import {
  LADDERS,
  MAX_PLAYERS,
  MIN_PLAYERS,
  PLAYER_COLORS,
  SNAKES,
  appendEvent,
  boardCells,
  createInitialRoomState,
  createPlayerState,
  movePlayer,
  movePathForResult,
  nextTurn,
  normalizePlayerState,
  normalizeRoomState,
  restartGame,
  rollDice,
  type SnakeLadderPlayerState,
  type SnakeLadderRoomState,
} from "@/lib/snakeLadder";
import * as Chess from "@/lib/chess";

const CLAIM_TYPES: ClaimType[] = ["ff", "line1", "line2", "line3", "housie"];

interface RoomRow {
  id: string;
  host_player_id: string;
  host_name: string;
  room_name: string;
  visibility: string;
  pin: string | null;
  prize_ff: number;
  prize_line1: number;
  prize_line2: number;
  prize_line3: number;
  prize_housie: number;
  housies_allowed: number;
  called_numbers: number[];
  housies_won: number;
  claimed: Record<string, string | string[]>;
  game_type: string;
  game_state: SnakeLadderRoomState | Chess.ChessRoomState | Record<string, never>;
  status: string;
}

interface PlayerRow {
  id: string;
  room_id: string;
  name: string;
  ticket: Ticket;
  game_state: SnakeLadderPlayerState | Chess.ChessPlayerState | Record<string, never>;
  marked_numbers: number[];
  purse: number;
  role: "player" | "spectator";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
  }

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is number => typeof v === "number").map((n) => Number(n));
}

function normalizeRoomRow(value: unknown): RoomRow {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    host_player_id: asString(row.host_player_id),
    host_name: asString(row.host_name),
    room_name: asString(row.room_name, "Tambola Room"),
    visibility: asString(row.visibility, "public"),
    pin: typeof row.pin === "string" ? row.pin : null,
    prize_ff: asNumber(row.prize_ff),
    prize_line1: asNumber(row.prize_line1),
    prize_line2: asNumber(row.prize_line2),
    prize_line3: asNumber(row.prize_line3),
    prize_housie: asNumber(row.prize_housie),
    housies_allowed: asNumber(row.housies_allowed, 1),
    called_numbers: asNumberArray(row.called_numbers),
    housies_won: asNumber(row.housies_won),
    claimed: asRecord(row.claimed) as Record<string, string | string[]>,
    game_type: asString(row.game_type, "tambola"),
    game_state: asRecord(row.game_state) as RoomRow["game_state"],
    status: asString(row.status, "waiting"),
  };
}

function normalizePlayerRow(value: unknown): PlayerRow {
  const row = asRecord(value);
  return {
    id: asString(row.id),
    room_id: asString(row.room_id),
    name: asString(row.name, "Player"),
    ticket: Array.isArray(row.ticket) ? (row.ticket as Ticket) : [],
    game_state: asRecord(row.game_state) as PlayerRow["game_state"],
    marked_numbers: asNumberArray(row.marked_numbers),
    purse: asNumber(row.purse),
    role: row.role === "spectator" ? "spectator" : "player",
  };
}

export const Route = createFileRoute("/room/$roomId")({
  component: RoomPage,
});

function RoomPage() {
  const { roomId } = Route.useParams();
  const navigate = useNavigate();
  const identity = typeof window !== "undefined" ? getIdentity(roomId) : undefined;
  const [room, setRoom] = useState<RoomRow | null>(null);
  const [players, setPlayers] = useState<PlayerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [celebration, setCelebration] = useState<{
    id: string;
    label: string;
    playerName: string;
    prize: number;
    purse?: number;
  } | null>(null);
  const autoAwarding = useRef<Set<ClaimType>>(new Set());
  const previousClaimed = useRef<Record<string, string | string[]> | null>(null);
  const celebratedClaims = useRef<Set<string>>(new Set());

  // Redirect home if no identity for this room.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!identity) navigate({ to: "/" });
  }, [identity, navigate]);

  // Initial load.
  useEffect(() => {
    let cancel = false;
    async function load() {
      try {
        const [{ data: r, error: rErr }, { data: ps, error: pErr }] = await Promise.all([
          supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
          supabase.from("players").select("*").eq("room_id", roomId).order("joined_at"),
        ]);
        if (rErr) throw rErr;
        if (pErr) throw pErr;
        if (cancel) return;
        setLoadError(null);
        setRoom(r ? normalizeRoomRow(r) : null);
        setPlayers((ps ?? []).map(normalizePlayerRow));
      } catch (e: unknown) {
        if (!cancel) {
          setLoadError(e instanceof Error ? e.message : "Failed to load room");
        }
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    load();
    return () => {
      cancel = true;
    };
  }, [roomId]);

  // Realtime + polling fallback (in case realtime stalls).
  useEffect(() => {
    let alive = true;
    async function refetch() {
      try {
        const [{ data: r, error: rErr }, { data: ps, error: pErr }] = await Promise.all([
          supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
          supabase.from("players").select("*").eq("room_id", roomId).order("joined_at"),
        ]);
        if (rErr) throw rErr;
        if (pErr) throw pErr;
        if (!alive) return;
        setLoadError(null);
        setRoom(r ? normalizeRoomRow(r) : null);
        setPlayers((ps ?? []).map(normalizePlayerRow));
      } catch (e: unknown) {
        console.error(e);
      }
    }

    const ch = supabase
      .channel(`room-${roomId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRoom(null);
          else setRoom(normalizeRoomRow(payload.new));
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "INSERT") {
              const np = normalizePlayerRow(payload.new);
              if (prev.some((p) => p.id === np.id)) return prev;
              return [...prev, np];
            }
            if (payload.eventType === "UPDATE") {
              const np = normalizePlayerRow(payload.new);
              return prev.map((p) => (p.id === np.id ? np : p));
            }
            if (payload.eventType === "DELETE") {
              const op = normalizePlayerRow(payload.old);
              return prev.filter((p) => p.id !== op.id);
            }
            return prev;
          });
        },
      )
      .subscribe();

    // Safety net: poll every 2.5s so the UI stays in sync even if the
    // realtime websocket drops or is slow to deliver an event.
    const interval = window.setInterval(refetch, 2500);
    return () => {
      alive = false;
      window.clearInterval(interval);
      supabase.removeChannel(ch);
    };
  }, [roomId]);

  const me = useMemo(
    () => (identity ? players.find((p) => p.id === identity.playerId) : undefined),
    [players, identity],
  );
  const isHost = !!(room && identity && room.host_player_id === identity.playerId);
  const isActiveRoom = room?.status === "waiting" || room?.status === "playing";
  const called = useMemo(() => new Set(room?.called_numbers ?? []), [room]);
  const marked = useMemo(() => new Set(me?.marked_numbers ?? []), [me]);

  const handleCellClick = useCallback(
    async (n: number) => {
      if (!me || !room) return;
      if (room.status !== "waiting" && room.status !== "playing") return;
      if (!called.has(n)) {
        toast.error("Number has not arrived yet");
        return;
      }
      const isMarked = marked.has(n);
      const next = isMarked ? me.marked_numbers.filter((x) => x !== n) : [...me.marked_numbers, n];
      setPlayers((prev) => prev.map((p) => (p.id === me.id ? { ...p, marked_numbers: next } : p)));
      const { error } = await supabase
        .from("players")
        .update({ marked_numbers: next })
        .eq("id", me.id);
      if (error) toast.error(error.message);
    },
    [me, room, called, marked],
  );

  const handleNextNumber = useCallback(async () => {
    if (!room || !isHost) return;
    if (room.status !== "waiting" && room.status !== "playing") return;
    const all = Array.from({ length: 90 }, (_, i) => i + 1);
    const remaining = all.filter((n) => !called.has(n));
    if (remaining.length === 0) return toast.error("All numbers called");
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    const newCalled = [...room.called_numbers, pick];
    const newStatus = room.status === "waiting" ? "playing" : room.status;
    // Optimistic local update so the host gets instant feedback.
    setRoom({ ...room, called_numbers: newCalled, status: newStatus });
    const { error } = await supabase
      .from("rooms")
      .update({ called_numbers: newCalled, status: newStatus })
      .eq("id", room.id);
    if (error) {
      toast.error(error.message);
      setRoom(room); // rollback
    }
  }, [room, isHost, called]);

  const handleRoomStatus = useCallback(
    async (status: "waiting" | "stopped") => {
      if (!room || !isHost || room.status === "ended" || room.status === status) return;
      const previous = room;
      setRoom({ ...room, status });
      const { error } = await supabase.from("rooms").update({ status }).eq("id", room.id);
      if (error) {
        toast.error(error.message);
        setRoom(previous);
        return;
      }
      toast.success(status === "stopped" ? "Room stopped" : "Room started");
    },
    [isHost, room],
  );

  const awardPrize = useCallback(
    async (type: ClaimType) => {
      if (!me || !room) return;
      if (room.status !== "playing" && room.status !== "waiting") return;

      const result = validateClaim(type, me.ticket, room.called_numbers, me.marked_numbers);
      const prize = prizeFor(room, type);
      const claimed = { ...(room.claimed || {}) };

      if (!result.ok) {
        return;
      }

      // Quick client-side guard for instant feedback (server is the source of truth).
      if (type === "housie") {
        const prev = Array.isArray(claimed.housie) ? claimed.housie : [];
        if (prev.includes(me.id)) return toast.error("You already claimed Housie");
        if (prev.length >= room.housies_allowed) return toast.error("All Housies already claimed");
      } else if (claimed[type]) {
        return toast.error(`${CLAIM_LABELS[type]} already claimed`);
      }

      // Atomic server-side claim — prevents the same prize being awarded twice in a race.
      const { data, error } = await supabase.rpc("claim_prize", {
        p_room_id: room.id,
        p_player_id: me.id,
        p_type: type,
        p_prize: prize,
      });
      if (error) {
        toast.error(error.message);
        return;
      }
      const res = data as { ok: boolean; reason?: string } | null;
      if (!res?.ok) {
        const reason = res?.reason ?? "Prize already awarded";
        if (!/already claimed|already awarded|all housies/i.test(reason)) toast.error(reason);
        return;
      }
      const claimId = `${type}:${me.id}`;
      celebratedClaims.current.add(claimId);
      setCelebration({
        id: `${claimId}:${Date.now()}`,
        label: CLAIM_LABELS[type],
        playerName: me.name,
        prize,
        purse: me.purse + prize,
      });
      toast.success(`${CLAIM_LABELS[type]} awarded! +${prize}`);
    },
    [me, room],
  );

  useEffect(() => {
    if (!me || !room) return;
    if (room.status !== "playing" && room.status !== "waiting") return;

    for (const type of CLAIM_TYPES) {
      if (autoAwarding.current.has(type)) continue;
      if (isPrizeClaimed(room, type, me.id)) continue;

      const result = validateClaim(type, me.ticket, room.called_numbers, me.marked_numbers);
      if (!result.ok) continue;

      autoAwarding.current.add(type);
      void awardPrize(type).finally(() => {
        autoAwarding.current.delete(type);
      });
    }
  }, [awardPrize, me, room]);

  useEffect(() => {
    if (!room) return;
    const previous = previousClaimed.current;
    previousClaimed.current = room.claimed || {};
    if (!previous) return;

    for (const type of CLAIM_TYPES) {
      const before = playerIdsForClaim(previous[type]);
      const after = playerIdsForClaim(room.claimed?.[type]);
      const winnerId = after.find((id) => !before.includes(id));
      if (!winnerId) continue;

      const claimId = `${type}:${winnerId}`;
      if (celebratedClaims.current.has(claimId)) continue;
      celebratedClaims.current.add(claimId);

      const player = players.find((p) => p.id === winnerId);
      setCelebration({
        id: `${claimId}:${Date.now()}`,
        label: CLAIM_LABELS[type],
        playerName: player?.name ?? "Player",
        prize: prizeFor(room, type),
        purse: player?.purse,
      });
    }
  }, [players, room]);

  function handleExit() {
    if (!identity) {
      navigate({ to: "/" });
      return;
    }
    clearIdentity(roomId);
    // Remove the player record (only if not host or game ended).
    supabase
      .from("players")
      .delete()
      .eq("id", identity.playerId)
      .then(() => {
        navigate({ to: "/" });
      });
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading room…
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 px-4 text-center">
        <div>
          <h1 className="text-xl font-semibold">Room could not load</h1>
          <p className="mt-2 max-w-md text-sm text-muted-foreground">{loadError}</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => window.location.reload()}>Try again</Button>
          <Button variant="outline" onClick={() => navigate({ to: "/" })}>
            Go home
          </Button>
        </div>
      </div>
    );
  }
  if (!room) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>Room not found or has been closed.</p>
        <Button onClick={() => navigate({ to: "/" })}>Go home</Button>
      </div>
    );
  }
  if (!me) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p>You're not in this room.</p>
        <Button onClick={() => navigate({ to: "/" })}>Go home</Button>
      </div>
    );
  }

  if (room.game_type === "chess") {
    return <ChessRoom room={room} players={players} me={me} isHost={isHost} onExit={handleExit} />;
  }

  if (room.game_type === "snake-ladder") {
    return (
      <SnakeLadderRoom room={room} players={players} me={me} isHost={isHost} onExit={handleExit} />
    );
  }

  if (room.game_type === "carrom") {
    return (
      <CarromRoom room={room} players={players} me={me} isHost={isHost} onExit={handleExit} />
    );
  }

  const lastNumber = room.called_numbers[room.called_numbers.length - 1];
  const activePlayers = players.filter((p) => p.role !== "spectator");
  const spectators = players.filter((p) => p.role === "spectator");
  const isSpectator = me.role === "spectator";

  if (isSpectator) {
    return (
      <TambolaSpectatorView
        room={room}
        activePlayers={activePlayers}
        spectators={spectators}
        me={me}
        onExit={() => setExitOpen(true)}
        exitOpen={exitOpen}
        setExitOpen={setExitOpen}
        handleExit={handleExit}
      />
    );
  }

  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-6 max-w-7xl mx-auto pb-24 md:pb-6">
      <header className="flex items-start justify-between mb-4 sm:mb-6 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-primary truncate">
            {room.room_name || `Room ${room.id}`}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Code {room.id} · Host: {room.host_name}
            {isHost && " (you)"} · {activePlayers.length}P
            {spectators.length > 0 && ` · 👁 ${spectators.length}`}
            {" · "}Housie {room.housies_won}/
            {room.housies_allowed}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          {isHost &&
            room.status !== "ended" &&
            (room.status === "stopped" ? (
              <Button variant="default" size="sm" onClick={() => void handleRoomStatus("waiting")}>
                Start
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void handleRoomStatus("stopped")}
              >
                Stop
              </Button>
            ))}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(room.id);
              toast.success("Room code copied");
            }}
          >
            Copy
          </Button>
          <Button variant="destructive" size="sm" onClick={() => setExitOpen(true)}>
            Exit
          </Button>
        </div>
      </header>

      {room.status === "ended" ? (
        <Leaderboard room={room} players={players} />
      ) : (
        <div className="grid md:grid-cols-[1fr_320px] gap-4 md:gap-6">
          <div className="space-y-4 md:space-y-6">
            {room.status === "stopped" && (
              <Card className="p-4 text-sm text-muted-foreground">
                This room is stopped. The host can start it again when players should be able to
                join and play.
              </Card>
            )}
            {/* Last number + controls — hidden on mobile (replaced by sticky bottom bar) */}
            <Card className="p-4 md:p-5 hidden md:flex flex-col sm:flex-row items-center gap-5">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Last</div>
                  <div className="number-ball number-ball-called w-24 h-24 text-4xl">{lastNumber ?? "—"}</div>
                </div>
              </div>
              <div className="flex-1 w-full sm:w-auto">
                {isHost ? (
                  <Button
                    onClick={handleNextNumber}
                    size="lg"
                    className="w-full h-16 text-xl"
                    disabled={!isActiveRoom}
                  >
                    🎲 Next Number
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground text-center">
                    {room.status === "stopped" ? "Room is stopped by the host." : "Waiting for host to call the next number…"}
                  </p>
                )}
              </div>
            </Card>

            {/* Ticket */}
            <TambolaTicket
              ticket={me.ticket}
              marked={marked}
              called={called}
              onCellClick={handleCellClick}
              playerName={me.name}
            />

            <PrizeWatchPanel room={room} me={me} celebration={celebration} />

            {/* Called numbers board */}
            <Card className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-2 sm:mb-3">
                <div className="text-sm font-semibold">Called Numbers</div>
                <div className="text-sm text-right">
                  <div className="text-2xl font-bold">{room.called_numbers.length}/90</div>
                  <div className="text-xs text-muted-foreground uppercase tracking-wide">called</div>
                </div>
              </div>
              <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
                {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
                  const c = called.has(n);
                  return (
                    <div
                      key={n}
                      className={`aspect-square rounded flex items-center justify-center text-[10px] sm:text-xs font-bold ${
                        c ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground/50"
                      }`}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          {/* Sidebar */}
          <aside className="space-y-4">
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Players</div>
              <ul className="space-y-2">
                {players.map((p) => (
                  <li key={p.id} className="flex justify-between text-sm">
                    <span className={p.id === me.id ? "text-primary font-semibold" : ""}>
                      {p.name} {p.id === room.host_player_id && "👑"}
                    </span>
                    <span className="text-muted-foreground">{p.purse}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Prizes Claimed</div>
              <ul className="space-y-1 text-sm">
                <ClaimedRow label="Fastest Five" claim={room.claimed.ff} players={players} />
                <ClaimedRow label="Top Line" claim={room.claimed.line1} players={players} />
                <ClaimedRow label="Middle Line" claim={room.claimed.line2} players={players} />
                <ClaimedRow label="Bottom Line" claim={room.claimed.line3} players={players} />
                <ClaimedRow label="Housie" claim={room.claimed.housie} players={players} />
              </ul>
            </Card>
          </aside>
        </div>
      )}

      {/* Mobile sticky bottom bar: last number + next-number control */}
      {room.status !== "ended" && (
        <div className="md:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-card/95 backdrop-blur px-3 py-2 flex items-center gap-3 shadow-[0_-4px_20px_rgba(0,0,0,0.4)]">
          <div className="number-ball number-ball-called w-14 h-14 text-2xl shrink-0">
            {lastNumber ?? "—"}
          </div>
          {isHost ? (
            <Button
              onClick={handleNextNumber}
              className="flex-1 h-14 text-base font-bold"
              disabled={!isActiveRoom}
            >
              🎲 Next Number
            </Button>
          ) : (
            <div className="flex-1 text-xs text-center text-muted-foreground">
              {room.status === "stopped" ? "Room stopped" : "Waiting for host…"}
            </div>
          )}
        </div>
      )}

      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Exit the room?</AlertDialogTitle>
            <AlertDialogDescription>
              You will leave the game and lose access to this ticket. Are you sure?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setExitOpen(false);
                setTimeout(() => {
                  if (confirm("Really exit? This cannot be undone.")) handleExit();
                }, 100);
              }}
            >
              Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SnakeLadderRoom({
  room,
  players: allPlayers,
  me,
  isHost,
  onExit,
}: {
  room: RoomRow;
  players: PlayerRow[];
  me: PlayerRow;
  isHost: boolean;
  onExit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [rollingDice, setRollingDice] = useState(false);
  const [rollingDiceValue, setRollingDiceValue] = useState<number | null>(null);
  const spectators = allPlayers.filter((p) => p.role === "spectator");
  const players = allPlayers.filter((p) => p.role !== "spectator");
  const isSpectator = me.role === "spectator";
  const roomState = normalizeRoomState(room.game_state);
  const playerStates = players.map((player, index) =>
    normalizePlayerState(player.game_state, player.id, player.name, index),
  );
  const activePlayer = playerStates[roomState.currentTurnIndex % Math.max(playerStates.length, 1)];
  const myState = playerStates.find((player) => player.id === me.id);
  const winner = roomState.winnerId
    ? playerStates.find((player) => player.id === roomState.winnerId)
    : undefined;
  const canStart =
    isHost && room.status === "waiting" && players.length >= MIN_PLAYERS;
  const canRoll =
    room.status === "playing" &&
    !roomState.winnerId &&
    activePlayer?.id === me.id &&
    !!myState &&
    !myState.finished &&
    !busy;
  const turnLabel =
    room.status === "playing" && activePlayer
      ? activePlayer.id === me.id
        ? "Your Turn"
        : `${activePlayer.name}'s Turn`
      : room.status === "stopped"
        ? "Game Paused"
        : "Waiting to Start";
  const myColor = myState?.color ?? PLAYER_COLORS[0];
  const takenColors = playerStates
    .filter((player) => player.id !== me.id)
    .map((player) => player.color);
  const mobilePrimaryAction =
    isHost && room.status === "waiting"
      ? {
          label: "Start Game",
          onClick: startGame,
          disabled: !canStart || busy,
          variant: "default" as const,
        }
      : isHost && room.status === "playing"
        ? // If host is playing and it's their turn, show Roll Dice. Otherwise show Pause.
          canRoll
          ? {
              label: "Roll Dice",
              onClick: handleRollDice,
              disabled: !canRoll,
              variant: "default" as const,
            }
          : {
              label: "Pause Game",
              onClick: () => void handlePauseResume("stopped"),
              disabled: busy,
              variant: "secondary" as const,
            }
        : isHost && room.status === "stopped"
          ? {
              label: "Resume Game",
              onClick: () => void handlePauseResume("playing"),
              disabled: busy,
              variant: "default" as const,
            }
          : {
              label: "Roll Dice",
              onClick: handleRollDice,
              disabled: !canRoll,
              variant: "default" as const,
            };

  async function startGame() {
    if (!isHost) return;
    if (players.length < MIN_PLAYERS) return toast.error("Need at least 2 players");
    if (players.length > MAX_PLAYERS) return toast.error("Room is full");

    setBusy(true);
    try {
      const nextRoomState = appendEvent(createInitialRoomState(), "start-game", "Game started");
      const results = await Promise.all([
        supabase
          .from("rooms")
          .update({ status: "playing", game_state: nextRoomState as never })
          .eq("id", room.id),
        ...players.map((player, index) =>
          supabase
            .from("players")
            .update({
              game_state: createPlayerState(
                player.id,
                player.name,
                index,
                normalizePlayerState(player.game_state, player.id, player.name, index).color,
              ) as never,
            })
            .eq("id", player.id),
        ),
      ]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast.success("Snake N Ladder started");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start game");
    } finally {
      setBusy(false);
    }
  }

  async function handleRollDice() {
    if (!canRoll || !myState) return toast.error("Wait for your turn");

    setBusy(true);
    setRollingDice(true);
    try {
      const dice = rollDice();
      setRollingDiceValue(dice);
      await sleep(960);
      const result = movePlayer(myState, dice);
      const nextPlayerState: SnakeLadderPlayerState = {
        ...myState,
        position: result.finalPosition,
        finished: result.winner,
        movePath: movePathForResult(result),
      };

      let nextRoomState = normalizeRoomState(room.game_state);
      nextRoomState = {
        ...nextRoomState,
        lastDice: dice,
        winnerId: result.winner ? myState.id : null,
        currentTurnIndex: result.winner
          ? nextRoomState.currentTurnIndex
          : nextTurn(nextRoomState.currentTurnIndex, players.length),
      };

      nextRoomState = appendEvent(
        nextRoomState,
        "roll-dice",
        `${myState.name} rolled ${dice}`,
        myState.id,
      );
      nextRoomState = appendEvent(
        nextRoomState,
        "move-player",
        result.moved
          ? `${myState.name} moved from ${result.from} to ${result.attempted}`
          : `${myState.name} needs an exact finish and stayed at ${myState.position}`,
        myState.id,
      );
      if (result.snakeFrom) {
        nextRoomState = appendEvent(
          nextRoomState,
          "snake-hit",
          `${myState.name} slid from ${result.snakeFrom} to ${result.finalPosition}`,
          myState.id,
        );
      }
      if (result.ladderFrom) {
        nextRoomState = appendEvent(
          nextRoomState,
          "ladder-hit",
          `${myState.name} climbed from ${result.ladderFrom} to ${result.finalPosition}`,
          myState.id,
        );
      }
      if (result.winner) {
        nextRoomState = appendEvent(
          nextRoomState,
          "winner",
          `${myState.name} reached 100`,
          myState.id,
        );
      } else {
        const nextPlayer = players[nextRoomState.currentTurnIndex % players.length];
        nextRoomState = appendEvent(
          nextRoomState,
          "turn-change",
          `${nextPlayer?.name ?? "Next player"}'s turn`,
        );
      }

      const roomUpdate = result.winner
        ? { game_state: nextRoomState as never, status: "ended" }
        : { game_state: nextRoomState as never };

      const [playerUpdate, roomResult] = await Promise.all([
        supabase
          .from("players")
          .update({ game_state: nextPlayerState as never })
          .eq("id", me.id),
        supabase.from("rooms").update(roomUpdate).eq("id", room.id),
      ]);
      if (playerUpdate.error) throw playerUpdate.error;
      if (roomResult.error) throw roomResult.error;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to roll dice");
    } finally {
      setRollingDice(false);
      setRollingDiceValue(null);
      setBusy(false);
    }
  }

  async function handleRestart() {
    if (!isHost) return;
    setBusy(true);
    try {
      const restarted = restartGame(playerStates);
      const nextRoomState = appendEvent(restarted.roomState, "restart-game", "Game restarted");
      const results = await Promise.all([
        supabase
          .from("rooms")
          .update({ status: "waiting", game_state: nextRoomState as never })
          .eq("id", room.id),
        ...players.map((player, index) =>
          supabase
            .from("players")
            .update({ game_state: restarted.playerStates[index] as never })
            .eq("id", player.id),
        ),
      ]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast.success("Game reset");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to restart game");
    } finally {
      setBusy(false);
    }
  }

  async function handlePauseResume(nextStatus: "playing" | "stopped") {
    if (!isHost || !["playing", "stopped"].includes(room.status) || room.status === nextStatus) {
      return;
    }

    setBusy(true);
    try {
      const nextRoomState = appendEvent(
        normalizeRoomState(room.game_state),
        nextStatus === "stopped" ? "pause-game" : "resume-game",
        nextStatus === "stopped" ? "Game paused" : "Game resumed",
      );
      const { error } = await supabase
        .from("rooms")
        .update({ status: nextStatus, game_state: nextRoomState as never })
        .eq("id", room.id);
      if (error) throw error;
      toast.success(nextStatus === "stopped" ? "Game paused" : "Game resumed");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update game");
    } finally {
      setBusy(false);
    }
  }

  async function handleColorChange(color: string) {
    if (!myState || room.status !== "waiting") return;
    if (takenColors.includes(color)) return toast.error("That color is already taken");

    const nextState: SnakeLadderPlayerState = { ...myState, color };
    setBusy(true);
    try {
      const { error } = await supabase
        .from("players")
        .update({ game_state: nextState as never })
        .eq("id", me.id);
      if (error) throw error;
      toast.success("Color updated");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update color");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-6 max-w-7xl mx-auto pb-28 lg:pb-6">
      <header className="flex items-start justify-between mb-4 sm:mb-6 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-primary truncate flex items-center gap-2">
            {room.room_name || `Room ${room.id}`}
            {isSpectator && <SpectatorBadge />}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Snake N Ladder - Code {room.id} - Host: {room.host_name}
            {isHost && " (you)"} - {players.length}/{MAX_PLAYERS}P
            {spectators.length > 0 && ` · 👁 ${spectators.length}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(room.id);
              toast.success("Room code copied");
            }}
          >
            Copy
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Exit this room?")) onExit();
            }}
          >
            Exit
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="p-3 sm:p-4">
          <SnakeLadderBoard players={playerStates} currentPlayerId={me.id} />
        </Card>

        <aside className="space-y-4">
          <Card className="p-4">
            <div className="mb-4 rounded-md border border-primary/30 bg-primary/10 px-4 py-3 text-center">
              <div className="text-2xl font-black text-primary sm:text-3xl">{turnLabel}</div>
            </div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Turn</div>
                <div className="text-xs text-muted-foreground">
                  {winner
                    ? `${winner.name} won`
                    : room.status === "playing"
                      ? `${activePlayer?.name ?? "Player"} rolls next`
                      : "Waiting for host"}
                </div>
              </div>
              <Dice3D value={rollingDiceValue ?? roomState.lastDice} rolling={rollingDice} />
            </div>

            {winner ? (
              <div className="rounded-md border border-primary/40 bg-primary/10 p-3 text-sm">
                <div className="font-bold text-primary">{winner.name} reached cell 100.</div>
                <div className="mt-1 text-muted-foreground">The game is complete.</div>
              </div>
            ) : room.status !== "playing" ? (
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                {players.length < MIN_PLAYERS
                  ? `Need ${MIN_PLAYERS - players.length} more player to start.`
                  : "Ready to start."}
              </div>
            ) : null}

            <div className="mt-4 hidden gap-2 lg:grid">
              {isHost && room.status === "waiting" && (
                <Button onClick={startGame} disabled={!canStart || busy} className="h-12">
                  Start Game
                </Button>
              )}
              {isHost && room.status === "playing" && (
                <Button
                  onClick={() => void handlePauseResume("stopped")}
                  disabled={busy}
                  variant="secondary"
                  className="h-12"
                >
                  Pause Game
                </Button>
              )}
              {isHost && room.status === "stopped" && (
                <Button
                  onClick={() => void handlePauseResume("playing")}
                  disabled={busy}
                  className="h-12"
                >
                  Resume Game
                </Button>
              )}
              <Button onClick={handleRollDice} disabled={!canRoll} className="h-12">
                Roll Dice
              </Button>
              {isHost && (
                <Button
                  onClick={handleRestart}
                  disabled={busy}
                  variant="secondary"
                  className="h-12"
                >
                  Restart Game
                </Button>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Players</div>
            {room.status === "waiting" && myState && (
              <div className="mb-4">
                <div className="mb-2 text-xs text-muted-foreground">Your color</div>
                <div className="grid grid-cols-6 gap-2">
                  {PLAYER_COLORS.map((color) => {
                    const disabled = takenColors.includes(color);
                    return (
                      <button
                        key={color}
                        type="button"
                        disabled={disabled || busy}
                        className={`h-8 rounded-md border-2 border-white/80 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
                          myColor === color && !disabled
                            ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
                            : ""
                        }`}
                        style={{ background: color }}
                        aria-label={disabled ? "Color already taken" : `Use color ${color}`}
                        onClick={() => void handleColorChange(color)}
                      />
                    );
                  })}
                </div>
              </div>
            )}
            <ul className="space-y-2">
              {playerStates.map((player) => (
                <li
                  key={player.id}
                  className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: player.color }} />
                    <span
                      className={`truncate ${player.id === me.id ? "text-primary font-semibold" : ""}`}
                    >
                      {player.name}
                      {player.id === room.host_player_id ? " 👑" : ""}
                    </span>
                  </span>
                  <span className="font-bold">{player.position}</span>
                </li>
              ))}
            </ul>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Live Events</div>
            <ul className="space-y-2 text-sm">
              {roomState.eventLog.length === 0 ? (
                <li className="text-muted-foreground">No moves yet.</li>
              ) : (
                roomState.eventLog
                  .slice()
                  .reverse()
                  .map((event) => (
                    <li
                      key={event.id}
                      className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground"
                    >
                      {event.message}
                    </li>
                  ))
              )}
            </ul>
          </Card>

          {spectators.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Spectators ({spectators.length})</div>
              <ul className="space-y-1 text-sm">
                {spectators.map((s) => (
                  <li key={s.id} className={s.id === me.id ? "text-primary font-semibold" : "text-muted-foreground"}>
                    👁 {s.name}{s.id === me.id ? " (you)" : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-3 py-3 shadow-[0_-0.5rem_1.5rem_oklch(0_0_0_/_0.35)] backdrop-blur lg:hidden">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold text-primary">{turnLabel}</div>
            <div className="truncate text-xs text-muted-foreground">
              {winner
                ? `${winner.name} won`
                : room.status === "playing"
                  ? `${activePlayer?.name ?? "Player"} rolls next`
                  : players.length < MIN_PLAYERS
                    ? `Need ${MIN_PLAYERS - players.length} more player`
                    : "Ready to start"}
            </div>
          </div>
          <Button
            onClick={mobilePrimaryAction.onClick}
            disabled={mobilePrimaryAction.disabled}
            variant={mobilePrimaryAction.variant}
            className="h-12 min-w-36 text-base font-bold"
          >
            {mobilePrimaryAction.label}
          </Button>
        </div>
      </div>
    </div>
  );
}

const PUCK_STEP_MS = 420;
const PUCK_SETTLE_MS = 480;

function SnakeLadderBoard({
  players,
  currentPlayerId,
}: {
  players: SnakeLadderPlayerState[];
  currentPlayerId: string;
}) {
  const cells = boardCells();
  const prevPositionsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<number[]>([]);
  const animatingIdsRef = useRef<Set<string>>(new Set());
  const [displayPositions, setDisplayPositions] = useState<Record<string, number>>({});
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    const prev = prevPositionsRef.current;
    if (Object.keys(prev).length === 0) {
      const initial = Object.fromEntries(players.map((player) => [player.id, player.position]));
      prevPositionsRef.current = initial;
      setDisplayPositions(initial);
      return;
    }

    const changedPlayers: SnakeLadderPlayerState[] = [];
    for (const p of players) {
      if (
        prev[p.id] !== undefined &&
        prev[p.id] !== p.position &&
        !animatingIdsRef.current.has(p.id)
      ) {
        changedPlayers.push(p);
      }
    }

    const currentPositions = Object.fromEntries(players.map((player) => [player.id, player.position]));
    prevPositionsRef.current = currentPositions;

    if (changedPlayers.length > 0) {
      changedPlayers.forEach((player) => animatingIdsRef.current.add(player.id));
      setMovingIds((s) => {
        const next = new Set(s);
        changedPlayers.forEach((player) => next.add(player.id));
        return next;
      });
      setDisplayPositions((current) => {
        const next: Record<string, number> = {};
        players.forEach((player) => {
          next[player.id] = changedPlayers.some((changed) => changed.id === player.id)
            ? prev[player.id]
            : current[player.id] ?? player.position;
        });
        return next;
      });

      changedPlayers.forEach((player) => {
        const path = player.movePath.length > 0 ? player.movePath : [player.position];
        path.forEach((cell, index) => {
          const timer = window.setTimeout(() => {
            setDisplayPositions((current) => ({ ...current, [player.id]: cell }));
          }, index * PUCK_STEP_MS);
          timersRef.current.push(timer);
        });
      });

      const clearTimer = window.setTimeout(
        () => {
          changedPlayers.forEach((player) => animatingIdsRef.current.delete(player.id));
          setDisplayPositions((current) => {
            const next = { ...current };
            changedPlayers.forEach((player) => {
              next[player.id] = currentPositions[player.id];
            });
            return next;
          });
          setMovingIds((s) => {
            const next = new Set(s);
            changedPlayers.forEach((player) => next.delete(player.id));
            return next;
          });
        },
        Math.max(...changedPlayers.map((player) => Math.max(player.movePath.length, 1))) *
          PUCK_STEP_MS +
          PUCK_SETTLE_MS,
      );
      timersRef.current.push(clearTimer);
      return;
    }

    setDisplayPositions((current) => {
      const next: Record<string, number> = {};
      players.forEach((player) => {
        next[player.id] = animatingIdsRef.current.has(player.id)
          ? current[player.id] ?? player.position
          : player.position;
      });
      return next;
    });
  }, [players]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => window.clearTimeout(timer));
      timersRef.current = [];
      animatingIdsRef.current.clear();
    };
  }, []);
  return (
    <div className="relative aspect-square w-full max-w-[760px] overflow-hidden rounded-sm border-[10px] border-yellow-300 bg-yellow-300 shadow-2xl shadow-black/30">
      <div className="absolute inset-0 grid grid-cols-10">
        {cells.map((cell) => {
          return (
            <div
              key={cell}
              className={`relative min-w-0 border border-yellow-400/60 p-1 ${
                cell % 2 === 0 ? "bg-yellow-200" : "bg-yellow-400"
              }`}
            >
              <div className="relative z-30 text-[9px] font-black leading-none text-black sm:text-xs">
                {cell}
              </div>
            </div>
          );
        })}
      </div>

      {/* Animated player pucks overlay */}
      <div className="absolute inset-0 z-50 pointer-events-none">
        {players.map((player, index) => {
          const position = displayPositions[player.id] ?? player.position;
          const center = cellCenter(position);
          const cellMates = players.filter(
            (other) => (displayPositions[other.id] ?? other.position) === position,
          );
          const mateIndex = Math.max(
            0,
            cellMates.findIndex((other) => other.id === player.id),
          );
          const offset = puckOffset(mateIndex, cellMates.length || players.length, index);
          const moving = movingIds.has(player.id);
          const isCurrentPlayer = currentPlayerId === player.id;
          return (
            <div
              key={player.id}
              title={player.name}
              className={`player-puck ${isCurrentPlayer ? "player-puck-self" : ""}`}
              style={{
                left: `${center.x}%`,
                top: `${center.y}%`,
                color: player.color,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
              }}
            >
              <div
                className={`player-puck-inner ${moving ? "moving" : ""}`}
                style={{ "--puck-color": player.color } as CSSProperties}
              />
              {isCurrentPlayer && (
                <div className="player-arrow" style={{ color: player.color } as CSSProperties} aria-hidden>
                  <svg viewBox="0 0 24 24" width="20" height="20" xmlns="http://www.w3.org/2000/svg" fill="none">
                    <path d="M12 3v12m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <BoardArtwork />
    </div>
  );
}

function puckOffset(index: number, total: number, fallbackIndex: number) {
  if (total <= 1) return { x: 0, y: 0 };
  const radius = total <= 2 ? 7 : total <= 4 ? 8 : 10;
  const angle = ((index >= 0 ? index : fallbackIndex) / total) * Math.PI * 2 - Math.PI / 2;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius,
  };
}

function BoardArtwork() {
  const snakes = Object.entries(SNAKES).map(([from, to], index) => ({
    from: Number(from),
    to,
    index,
  }));
  const ladders = Object.entries(LADDERS).map(([from, to], index) => ({
    from: Number(from),
    to,
    index,
  }));

  return (
    <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 100 100">
      <defs>
        <linearGradient id="snakeGreen" x1="0" x2="1" y1="0" y2="1">
          <stop stopColor="oklch(0.89 0.19 126)" />
          <stop offset="0.46" stopColor="oklch(0.68 0.21 137)" />
          <stop offset="1" stopColor="oklch(0.43 0.17 147)" />
        </linearGradient>
        <linearGradient id="snakeBelly" x1="0" x2="1">
          <stop stopColor="oklch(0.97 0.14 92 / 0.95)" />
          <stop offset="1" stopColor="oklch(0.82 0.17 83 / 0.55)" />
        </linearGradient>
        <radialGradient id="snakeHead" cx="36%" cy="28%" r="72%">
          <stop stopColor="oklch(0.94 0.18 128)" />
          <stop offset="0.62" stopColor="oklch(0.65 0.22 140)" />
          <stop offset="1" stopColor="oklch(0.35 0.15 148)" />
        </radialGradient>
        <radialGradient id="snakeSpot" cx="36%" cy="32%" r="70%">
          <stop stopColor="oklch(0.98 0.14 93)" />
          <stop offset="1" stopColor="oklch(0.84 0.17 73)" />
        </radialGradient>
        <linearGradient id="ladderBlue" x1="0" x2="1">
          <stop stopColor="oklch(0.86 0.09 230)" />
          <stop offset="0.45" stopColor="oklch(0.67 0.16 241)" />
          <stop offset="1" stopColor="oklch(0.46 0.2 252)" />
        </linearGradient>
      </defs>

      {ladders.map((ladder) => (
        <LadderArt key={`${ladder.from}-${ladder.to}`} {...ladder} />
      ))}
      {snakes.map((snake) => (
        <SnakeArt key={`${snake.from}-${snake.to}`} {...snake} />
      ))}
    </svg>
  );
}

function LadderArt({ from, to, index }: { from: number; to: number; index: number }) {
  const start = cellCenter(from);
  const end = cellCenter(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = (-dy / length) * 1.15;
  const ny = (dx / length) * 1.15;
  const rungCount = Math.max(4, Math.min(8, Math.round(length / 6)));
  const rungs = Array.from({ length: rungCount }, (_, rung) => (rung + 1) / (rungCount + 1));
  const railWidth = index % 2 === 0 ? 0.48 : 0.42;

  return (
    <g opacity="0.96">
      <line
        x1={start.x + nx}
        y1={start.y + ny}
        x2={end.x + nx}
        y2={end.y + ny}
        stroke="oklch(0.19 0.07 252 / 0.45)"
        strokeWidth={railWidth + 0.35}
        strokeLinecap="round"
      />
      <line
        x1={start.x - nx}
        y1={start.y - ny}
        x2={end.x - nx}
        y2={end.y - ny}
        stroke="oklch(0.19 0.07 252 / 0.45)"
        strokeWidth={railWidth + 0.35}
        strokeLinecap="round"
      />
      <line
        x1={start.x + nx}
        y1={start.y + ny}
        x2={end.x + nx}
        y2={end.y + ny}
        stroke="url(#ladderBlue)"
        strokeWidth={railWidth}
        strokeLinecap="round"
      />
      <line
        x1={start.x - nx}
        y1={start.y - ny}
        x2={end.x - nx}
        y2={end.y - ny}
        stroke="url(#ladderBlue)"
        strokeWidth={railWidth}
        strokeLinecap="round"
      />
      {rungs.map((t) => {
        const x = start.x + dx * t;
        const y = start.y + dy * t;
        return (
          <line
            key={t}
            x1={x + nx * 1.15}
            y1={y + ny * 1.15}
            x2={x - nx * 1.15}
            y2={y - ny * 1.15}
            stroke="url(#ladderBlue)"
            strokeLinecap="round"
            strokeWidth={railWidth * 0.8}
          />
        );
      })}
    </g>
  );
}

function SnakeArt({ from, to, index }: { from: number; to: number; index: number }) {
  const profile = snakeProfile(from, to);
  const points = profile.points;
  const start = points[0];
  const end = points[points.length - 1];
  const next = points[1] ?? end;
  const dx = next.x - start.x;
  const dy = next.y - start.y;
  const length = Math.hypot(dx, dy) || 1;
  const unitX = dx / length;
  const unitY = dy / length;
  const angle = Math.atan2(dy, dx) * 57.2958;
  const path = smoothPath(points);
  const strokeWidth = profile.width * 1.18;
  const headX = start.x - unitX * strokeWidth * 0.36;
  const headY = start.y - unitY * strokeWidth * 0.36;
  const frontX = -unitX;
  const frontY = -unitY;
  const sideX = -unitY;
  const sideY = unitX;
  const eyeOffsetX = -unitY * strokeWidth * 0.34;
  const eyeOffsetY = unitX * strokeWidth * 0.34;
  const mouthX = headX + frontX * strokeWidth * 0.68;
  const mouthY = headY + frontY * strokeWidth * 0.68;
  const tongueStemX = headX + frontX * strokeWidth * 1.42;
  const tongueStemY = headY + frontY * strokeWidth * 1.42;
  const tongueTipX = headX + frontX * strokeWidth * 1.88;
  const tongueTipY = headY + frontY * strokeWidth * 1.88;
  const spots = snakeSpots(points, strokeWidth, index);
  const tail = points[points.length - 1];
  const beforeTail = points[points.length - 2] ?? tail;
  const tailAngle = Math.atan2(tail.y - beforeTail.y, tail.x - beforeTail.x) * 57.2958;

  return (
    <g opacity="0.96">
      <path
        d={path}
        fill="none"
        stroke="oklch(0.1 0.04 120)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth + 1.05}
      />
      <path
        d={path}
        fill="none"
        stroke="url(#snakeGreen)"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={strokeWidth}
      />
      <path
        d={path}
        fill="none"
        stroke="url(#snakeBelly)"
        strokeLinecap="round"
        strokeWidth={strokeWidth * 0.34}
        transform={`translate(${-unitY * strokeWidth * 0.2} ${unitX * strokeWidth * 0.2})`}
      />
      <ellipse
        cx={tail.x}
        cy={tail.y}
        rx={strokeWidth * 0.34}
        ry={strokeWidth * 0.16}
        fill="oklch(0.1 0.04 120)"
        transform={`rotate(${tailAngle} ${tail.x} ${tail.y})`}
      />
      {spots.map((spot) => (
        <ellipse
          key={`${spot.x}-${spot.y}`}
          cx={spot.x}
          cy={spot.y}
          rx={strokeWidth * 0.36}
          ry={strokeWidth * 0.22}
          fill="oklch(0.1 0.04 120)"
          opacity="0.45"
          transform={`rotate(${spot.rotate} ${spot.x} ${spot.y})`}
        />
      ))}
      {spots.map((spot) => (
        <ellipse
          key={`fill-${spot.x}-${spot.y}`}
          cx={spot.x}
          cy={spot.y}
          rx={strokeWidth * 0.3}
          ry={strokeWidth * 0.17}
          fill="url(#snakeSpot)"
          transform={`rotate(${spot.rotate} ${spot.x} ${spot.y})`}
        />
      ))}
      <ellipse
        cx={headX}
        cy={headY}
        rx={strokeWidth * 1.18}
        ry={strokeWidth * 0.9}
        fill="oklch(0.1 0.04 120)"
        transform={`rotate(${angle} ${headX} ${headY})`}
      />
      <ellipse
        cx={headX}
        cy={headY}
        rx={strokeWidth}
        ry={strokeWidth * 0.72}
        fill="url(#snakeHead)"
        transform={`rotate(${angle} ${headX} ${headY})`}
      />
      <circle
        cx={headX + eyeOffsetX - unitX * strokeWidth * 0.12}
        cy={headY + eyeOffsetY - unitY * strokeWidth * 0.12}
        r={strokeWidth * 0.23}
        fill="oklch(0.99 0.01 100)"
        stroke="oklch(0.1 0.04 120)"
        strokeWidth="0.12"
      />
      <circle
        cx={headX - eyeOffsetX - unitX * strokeWidth * 0.12}
        cy={headY - eyeOffsetY - unitY * strokeWidth * 0.12}
        r={strokeWidth * 0.23}
        fill="oklch(0.99 0.01 100)"
        stroke="oklch(0.1 0.04 120)"
        strokeWidth="0.12"
      />
      <circle
        cx={headX + eyeOffsetX - unitX * strokeWidth * 0.18}
        cy={headY + eyeOffsetY - unitY * strokeWidth * 0.18}
        r={strokeWidth * 0.08}
        fill="oklch(0.08 0.02 40)"
      />
      <circle
        cx={headX - eyeOffsetX - unitX * strokeWidth * 0.18}
        cy={headY - eyeOffsetY - unitY * strokeWidth * 0.18}
        r={strokeWidth * 0.08}
        fill="oklch(0.08 0.02 40)"
      />
      <path
        d={`M ${mouthX} ${mouthY} L ${tongueStemX} ${tongueStemY} M ${tongueStemX} ${tongueStemY} L ${tongueTipX + sideX * strokeWidth * 0.24} ${tongueTipY + sideY * strokeWidth * 0.24} M ${tongueStemX} ${tongueStemY} L ${tongueTipX - sideX * strokeWidth * 0.24} ${tongueTipY - sideY * strokeWidth * 0.24}`}
        stroke="oklch(0.61 0.24 24)"
        strokeLinecap="round"
        strokeWidth="0.28"
      />
    </g>
  );
}

type BoardPoint = { x: number; y: number };

// Keep profiles empty to use a simple, predictable snake routing.
const SNAKE_PROFILES: Record<number, { width: number; offsets: [number, number][] }> = {};

function snakeProfile(from: number, to: number) {
  const start = cellCenter(from);
  const end = cellCenter(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy) || 1;

  // Sample density balanced for smoothness vs performance
  const segments = Math.max(10, Math.min(48, Math.round(dist / 3)));

  // Perpendicular (unit) vector for waving offset
  const nx = -dy / dist;
  const ny = dx / dist;

  // Deterministic per-snake phase so snakes vary but are stable
  const phase = Math.abs(Math.sin(from * 12.9898 + to * 78.233)) * Math.PI * 2;

  const waves = Math.max(1, Math.round(dist / 26));
  // Base amplitude scales with distance but large snakes get reduced amplitude
  let maxAmp = Math.min(34, dist * 0.16);
  if (dist > 60) maxAmp *= 0.55; // reduce amplitude for long snakes to avoid overlaps
  if (from === 99) maxAmp *= 0.6; // special-case head 99 to keep it compact

  const raw: BoardPoint[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const baseX = start.x + dx * t;
    const baseY = start.y + dy * t;

    // Envelope emphasizes mid-body but keeps ends gentle
    const envelope = Math.sin(Math.PI * t) ** 0.9;

    // Single harmonic for smooth wiggle
    const harmonic = Math.sin(t * Math.PI * waves + phase);

    // Gentle global bend to avoid perfectly straight snakes
    const bend = Math.sin((t - 0.5) * Math.PI) * dist * 0.02 * (dist > 60 ? 0.6 : 1);

    const wave = (harmonic * maxAmp + bend) * envelope;

    raw.push({ x: baseX + nx * wave, y: baseY + ny * wave });
  }

  // Chaikin subdivision (corner-cutting) to smooth polyline without overshoot.
  function chaikin(points: BoardPoint[]) {
    if (points.length < 2) return points.slice();
    const out: BoardPoint[] = [];
    out.push(points[0]);
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      out.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      out.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    out.push(points[points.length - 1]);
    return out;
  }

  let points = raw;
  // Apply two Chaikin passes for smooth, broad curves (three made very elongated shapes)
  points = chaikin(points);
  points = chaikin(points);

  const width = 1.5 + Math.min(1.8, dist / 120);
  return { width, points };
}

function smoothPath(points: BoardPoint[]) {
  // Use Catmull-Rom to Cubic Bezier conversion for smoother, more natural curves.
  if (points.length < 2) return "";
  const tension = 0.5; // lower -> looser, smoother curves
  const cmds: string[] = [];
  cmds.push(`M ${points[0].x} ${points[0].y}`);

  if (points.length === 2) {
    const p0 = points[0];
    const p1 = points[1];
    const cp1x = p0.x + (p1.x - p0.x) / 3;
    const cp1y = p0.y + (p1.y - p0.y) / 3;
    const cp2x = p0.x + (2 * (p1.x - p0.x)) / 3;
    const cp2y = p0.y + (2 * (p1.y - p0.y)) / 3;
    cmds.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`);
    return cmds.join(" ");
  }

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;

    const cp1x = p1.x + (p2.x - p0.x) / 6 * tension;
    const cp1y = p1.y + (p2.y - p0.y) / 6 * tension;
    const cp2x = p2.x - (p3.x - p1.x) / 6 * tension;
    const cp2y = p2.y - (p3.y - p1.y) / 6 * tension;

    cmds.push(`C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2.x} ${p2.y}`);
  }
  return cmds.join(" ");
}

function snakeSpots(points: BoardPoint[], strokeWidth: number, index: number) {
  const segments = points.slice(0, -1).map((point, pointIndex) => {
    const next = points[pointIndex + 1];
    return {
      start: point,
      end: next,
      length: Math.hypot(next.x - point.x, next.y - point.y),
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  const count = Math.max(5, Math.min(12, Math.round(totalLength / 5.8)));

  return Array.from({ length: count }, (_, spotIndex) => {
    let distance = ((spotIndex + 1) / (count + 1)) * totalLength;
    let segment = segments[0];
    for (const candidate of segments) {
      if (distance <= candidate.length) {
        segment = candidate;
        break;
      }
      distance -= candidate.length;
    }

    const t = segment.length ? distance / segment.length : 0;
    const dx = segment.end.x - segment.start.x;
    const dy = segment.end.y - segment.start.y;
    const length = Math.hypot(dx, dy) || 1;
    const wave = Math.sin((spotIndex + 1) * 1.9 + index) * strokeWidth * 0.26;
    return {
      x: segment.start.x + dx * t + (-dy / length) * wave,
      y: segment.start.y + dy * t + (dx / length) * wave,
      rotate: Math.atan2(dy, dx) * 57.2958,
    };
  });
}

function Dice3D({ value, rolling }: { value: number | null; rolling: boolean }) {
  const displayValue = value ?? 1;
  return (
    <div className="dice-shell" aria-label={value ? `Dice rolled ${value}` : "Dice not rolled yet"}>
      <div className={`dice-cube dice-face-${displayValue} ${rolling ? "dice-rolling" : ""}`}>
        {[1, 2, 3, 4, 5, 6].map((face) => (
          <div key={face} className={`dice-side dice-side-${face}`}>
            {Array.from({ length: 9 }, (_, index) => (
              <span
                key={index}
                className={dicePips(face).includes(index + 1) ? "dice-pip" : ""}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function dicePips(face: number) {
  const pips: Record<number, number[]> = {
    1: [5],
    2: [1, 9],
    3: [1, 5, 9],
    4: [1, 3, 7, 9],
    5: [1, 3, 5, 7, 9],
    6: [1, 3, 4, 6, 7, 9],
  };
  return pips[face] ?? pips[1];
}

function cellCenter(cell: number) {
  const rowFromBottom = Math.floor((cell - 1) / 10);
  const indexInRow = (cell - 1) % 10;
  const col = rowFromBottom % 2 === 0 ? indexInRow : 9 - indexInRow;
  return {
    x: col * 10 + 5,
    y: (9 - rowFromBottom) * 10 + 5,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function prizeFor(room: RoomRow, type: ClaimType) {
  if (type === "ff") return room.prize_ff;
  if (type === "line1") return room.prize_line1;
  if (type === "line2") return room.prize_line2;
  if (type === "line3") return room.prize_line3;
  return room.prize_housie;
}

function playerIdsForClaim(claim: string | string[] | undefined) {
  if (!claim) return [];
  return Array.isArray(claim) ? claim : [claim];
}

function isPrizeClaimed(room: RoomRow, type: ClaimType, playerId: string) {
  const claim = room.claimed?.[type];
  if (type === "housie") {
    const winners = playerIdsForClaim(claim);
    return winners.includes(playerId) || winners.length >= room.housies_allowed;
  }
  return !!claim;
}

function PrizeWatchPanel({
  room,
  me,
  celebration,
}: {
  room: RoomRow;
  me: PlayerRow;
  celebration: {
    id: string;
    label: string;
    playerName: string;
    prize: number;
    purse?: number;
  } | null;
}) {
  return (
    <Card className="overflow-hidden">
      {celebration ? (
        <div
          key={celebration.id}
          className="border-b border-primary/30 bg-primary/15 px-4 py-4 sm:px-5"
        >
          <div className="text-xs font-semibold uppercase text-primary">Prize unlocked</div>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-2xl font-bold">{celebration.label}</div>
              <div className="text-sm text-muted-foreground">
                {celebration.playerName} won {celebration.prize}
              </div>
            </div>
            <div className="text-left sm:text-right">
              <div className="text-xs text-muted-foreground">Prize</div>
              <div className="text-3xl font-black text-primary">+{celebration.prize}</div>
              {typeof celebration.purse === "number" && (
                <div className="text-xs text-muted-foreground">Purse {celebration.purse}</div>
              )}
            </div>
          </div>
        </div>
      ) : null}
      <div className="p-3 sm:p-4">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <div className="text-sm font-semibold">Automatic prize check</div>
            <div className="text-xs text-muted-foreground">
              Prizes are awarded as soon as your marked ticket qualifies.
            </div>
          </div>
          <div className="rounded-md bg-muted px-3 py-2 text-right">
            <div className="text-[10px] uppercase text-muted-foreground">Purse</div>
            <div className="text-lg font-bold text-primary">{me.purse}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          {CLAIM_TYPES.map((type) => (
            <PrizeStatus key={type} room={room} type={type} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function PrizeStatus({ room, type }: { room: RoomRow; type: ClaimType }) {
  const winners = playerIdsForClaim(room.claimed?.[type]);
  const claimed = type === "housie" ? winners.length >= room.housies_allowed : winners.length > 0;
  return (
    <div
      className={`rounded-md border p-3 ${claimed ? "border-primary/40 bg-primary/10" : "border-border bg-muted/40"}`}
    >
      <div className="text-xs font-semibold">{CLAIM_LABELS[type]}</div>
      <div className="mt-1 text-lg font-bold">{prizeFor(room, type)}</div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {type === "housie"
          ? `${winners.length}/${room.housies_allowed} won`
          : claimed
            ? "Awarded"
            : "Watching"}
      </div>
    </div>
  );
}

function ClaimedRow({
  label,
  claim,
  players,
}: {
  label: string;
  claim: string | string[] | undefined;
  players: PlayerRow[];
}) {
  function nameOf(id: string) {
    return players.find((p) => p.id === id)?.name ?? "—";
  }
  const text = !claim ? "—" : Array.isArray(claim) ? claim.map(nameOf).join(", ") : nameOf(claim);
  return (
    <li className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-right truncate">{text}</span>
    </li>
  );
}

function Leaderboard({ room, players }: { room: RoomRow; players: PlayerRow[] }) {
  const sorted = [...players].sort((a, b) => b.purse - a.purse);
  return (
    <Card className="p-8 max-w-2xl mx-auto text-center">
      <div className="text-5xl mb-2">🏆</div>
      <h2 className="text-3xl font-bold text-primary mb-1">Game Over!</h2>
      <p className="text-muted-foreground mb-6">Final standings for Room {room.id}</p>
      <ul className="space-y-2 text-left">
        {sorted.map((p, i) => (
          <li
            key={p.id}
            className={`flex items-center justify-between p-4 rounded-lg ${
              i === 0 ? "bg-primary text-primary-foreground" : "bg-muted"
            }`}
          >
            <span className="font-semibold flex items-center gap-3">
              <span className="text-2xl">{["🥇", "🥈", "🥉"][i] ?? `#${i + 1}`}</span>
              {p.name}
            </span>
            <span className="text-xl font-bold">{p.purse}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SpectatorBadge({ count }: { count?: number }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 border border-amber-500/30">
      👁 Spectating{typeof count === "number" ? ` · ${count}` : ""}
    </span>
  );
}

function TambolaSpectatorView({
  room,
  activePlayers,
  spectators,
  me,
  onExit,
  exitOpen,
  setExitOpen,
  handleExit,
}: {
  room: RoomRow;
  activePlayers: PlayerRow[];
  spectators: PlayerRow[];
  me: PlayerRow;
  onExit: () => void;
  exitOpen: boolean;
  setExitOpen: (v: boolean) => void;
  handleExit: () => void;
}) {
  const called = new Set(room.called_numbers);
  const lastNumber = room.called_numbers[room.called_numbers.length - 1];
  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-6 max-w-7xl mx-auto pb-6">
      <header className="flex items-start justify-between mb-4 sm:mb-6 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-primary truncate flex items-center gap-2">
            {room.room_name || `Room ${room.id}`} <SpectatorBadge />
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Code {room.id} · Host: {room.host_name} · {activePlayers.length} playing · {spectators.length} watching
          </p>
        </div>
        <Button variant="destructive" size="sm" onClick={onExit}>
          Exit
        </Button>
      </header>

      {room.status === "ended" ? (
        <Leaderboard room={room} players={activePlayers} />
      ) : (
        <div className="grid lg:grid-cols-[1fr_320px] gap-4 md:gap-6">
          <div className="space-y-4">
            <Card className="p-4 flex items-center gap-4">
              <div className="text-center">
                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Last</div>
                <div className="number-ball number-ball-called w-20 h-20 text-3xl">{lastNumber ?? "—"}</div>
              </div>
              <div className="flex-1">
                <div className="text-2xl font-bold">{room.called_numbers.length}/90</div>
                <div className="text-xs text-muted-foreground uppercase tracking-wide">called</div>
              </div>
            </Card>

            <div className="grid sm:grid-cols-2 gap-4">
              {activePlayers.map((p) => (
                <TambolaTicket
                  key={p.id}
                  ticket={p.ticket}
                  marked={new Set(p.marked_numbers)}
                  called={called}
                  onCellClick={() => {}}
                  playerName={`${p.name} · ${p.purse}`}
                />
              ))}
              {activePlayers.length === 0 && (
                <Card className="p-6 text-sm text-muted-foreground col-span-full">
                  No active players yet.
                </Card>
              )}
            </div>

            <Card className="p-3 sm:p-4">
              <div className="flex items-center justify-between mb-2">
                <div className="text-sm font-semibold">Called Numbers</div>
                <div className="text-sm">{room.called_numbers.length}/90</div>
              </div>
              <div className="grid grid-cols-10 gap-1 sm:gap-1.5">
                {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
                  const c = called.has(n);
                  return (
                    <div
                      key={n}
                      className={`aspect-square rounded flex items-center justify-center text-[10px] sm:text-xs font-bold ${
                        c ? "bg-accent text-accent-foreground" : "bg-muted text-muted-foreground/50"
                      }`}
                    >
                      {n}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Players</div>
              <ul className="space-y-2 text-sm">
                {activePlayers.map((p) => (
                  <li key={p.id} className="flex justify-between">
                    <span>{p.name} {p.id === room.host_player_id && "👑"}</span>
                    <span className="text-muted-foreground">{p.purse}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Prizes Claimed</div>
              <ul className="space-y-1 text-sm">
                <ClaimedRow label="Fastest Five" claim={room.claimed.ff} players={activePlayers} />
                <ClaimedRow label="Top Line" claim={room.claimed.line1} players={activePlayers} />
                <ClaimedRow label="Middle Line" claim={room.claimed.line2} players={activePlayers} />
                <ClaimedRow label="Bottom Line" claim={room.claimed.line3} players={activePlayers} />
                <ClaimedRow label="Housie" claim={room.claimed.housie} players={activePlayers} />
              </ul>
            </Card>
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Spectators ({spectators.length})</div>
              <ul className="space-y-1 text-sm">
                {spectators.map((s) => (
                  <li key={s.id} className={s.id === me.id ? "text-primary font-semibold" : ""}>
                    👁 {s.name}{s.id === me.id ? " (you)" : ""}
                  </li>
                ))}
              </ul>
            </Card>
          </aside>
        </div>
      )}

      <AlertDialog open={exitOpen} onOpenChange={setExitOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Leave spectator mode?</AlertDialogTitle>
            <AlertDialogDescription>You'll stop watching this game.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setExitOpen(false);
                setTimeout(() => {
                  if (confirm("Really exit?")) handleExit();
                }, 100);
              }}
            >
              Exit
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ChessRoom({
  room,
  players: allPlayers,
  me,
  isHost,
  onExit,
}: {
  room: RoomRow;
  players: PlayerRow[];
  me: PlayerRow;
  isHost: boolean;
  onExit: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const spectators = allPlayers.filter((p) => p.role === "spectator");
  const players = allPlayers.filter((p) => p.role !== "spectator");
  const isSpectator = me.role === "spectator";
  const roomState = Chess.normalizeRoomState(room.game_state);
  const activeSide = Chess.turnSide(roomState.fen);
  const gameStatus = Chess.gameStatus(roomState.fen);
  const playerStates = players.map((player, index) =>
    Chess.normalizePlayerState(player.game_state, player.id, player.name, index),
  );
  const myChessState = playerStates.find((player) => player.id === me.id);
  const activePlayer = playerStates.find((player) => player.side === activeSide);
  const winner = gameStatus.winningSide
    ? playerStates.find((player) => player.side === gameStatus.winningSide)
    : null;
  const isMyTurn = room.status === "playing" && myChessState?.side === activeSide;
  const turnText =
    room.status === "waiting"
      ? "Waiting for both players"
      : gameStatus.kind === "checkmate"
        ? winner?.id === me.id
          ? "You won"
          : "Opponent won"
        : gameStatus.kind === "draw" || gameStatus.kind === "stalemate"
          ? "Game drawn"
          : isMyTurn
            ? "Your turn"
            : "Opponent's turn";
  const canStart = isHost && room.status === "waiting" && players.length >= Chess.MIN_PLAYERS;
  const legalMoves = useMemo(
    () => (selectedSquare ? Chess.legalMovesFor(roomState.fen, selectedSquare) : []),
    [roomState.fen, selectedSquare],
  );

  useEffect(() => {
    setSelectedSquare(null);
  }, [roomState.fen]);

  async function startGame() {
    if (!isHost) return;
    if (players.length < Chess.MIN_PLAYERS) return toast.error("Need at least 2 players");
    if (players.length > Chess.MAX_PLAYERS) return toast.error("Room is full");

    setBusy(true);
    try {
      const nextRoomState = Chess.appendEvent(Chess.createInitialRoomState(), "start-game", "Game started");
      const results = await Promise.all([
        supabase
          .from("rooms")
          .update({ status: "playing", game_state: nextRoomState as never })
          .eq("id", room.id),
        ...players.map((player, index) =>
          supabase
            .from("players")
            .update({ game_state: Chess.createPlayerState(player.id, player.name, index) as never })
            .eq("id", player.id),
        ),
      ]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast.success("Chess started");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to start game");
    } finally {
      setBusy(false);
    }
  }

  async function handleRestart() {
    if (!isHost) return;
    setBusy(true);
    try {
      const nextRoomState = Chess.appendEvent(Chess.createInitialRoomState(), "restart-game", "Game restarted");
      const results = await Promise.all([
        supabase
          .from("rooms")
          .update({ status: "waiting", game_state: nextRoomState as never })
          .eq("id", room.id),
        ...players.map((player, index) =>
          supabase
            .from("players")
            .update({ game_state: Chess.createPlayerState(player.id, player.name, index) as never })
            .eq("id", player.id),
        ),
      ]);
      const failed = results.find((result) => result.error);
      if (failed?.error) throw failed.error;
      toast.success("Game reset");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to restart game");
    } finally {
      setBusy(false);
    }
  }

  async function handleSquareClick(square: Square) {
    if (busy || room.status !== "playing") return;
    if (!myChessState || myChessState.side !== activeSide) {
      return toast.error("Wait for your turn");
    }

    const piece = Chess.pieceAt(roomState.fen, square);
    const clickedOwnPiece =
      piece?.color === (myChessState.side === "white" ? "w" : "b");

    if (!selectedSquare) {
      if (!clickedOwnPiece) return;
      setSelectedSquare(square);
      return;
    }

    if (selectedSquare === square) {
      setSelectedSquare(null);
      return;
    }

    if (clickedOwnPiece) {
      setSelectedSquare(square);
      return;
    }

    const legalMove = legalMoves.find((move) => move.to === square);
    if (!legalMove) return toast.error("That piece cannot move there");

    const movedState = Chess.makeMove(roomState, selectedSquare, square);
    if (!movedState?.lastMove) return toast.error("Illegal move");

    const movedStatus = Chess.gameStatus(movedState.fen);
    const nextWinnerId = movedStatus.winningSide
      ? playerStates.find((player) => player.side === movedStatus.winningSide)?.id ?? null
      : null;
    const nextRoomState = Chess.appendEvent(
      { ...movedState, winnerId: nextWinnerId },
      movedStatus.kind === "checkmate" ? "checkmate" : "move",
      movedStatus.kind === "checkmate"
        ? `${myChessState.name}: ${movedState.lastMove.san} checkmate`
        : `${myChessState.name}: ${movedState.lastMove.san}`,
      me.id,
    );
    const nextStatus = movedStatus.kind === "checkmate" ? "ended" : "playing";

    setBusy(true);
    setSelectedSquare(null);
    try {
      const { error } = await supabase
        .from("rooms")
        .update({ game_state: nextRoomState as never, status: nextStatus })
        .eq("id", room.id);
      if (error) throw error;
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to move piece");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen px-3 sm:px-4 py-4 sm:py-6 max-w-7xl mx-auto pb-28 lg:pb-6">
      <header className="flex items-start justify-between mb-4 sm:mb-6 gap-2">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold text-primary truncate flex items-center gap-2">
            {room.room_name || `Room ${room.id}`}
            {isSpectator && <SpectatorBadge />}
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground">
            Chess - Code {room.id} - Host: {room.host_name}
            {isHost && " (you)"} - {players.length}/{Chess.MAX_PLAYERS}P
            {spectators.length > 0 && ` · 👁 ${spectators.length}`}
          </p>
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              navigator.clipboard.writeText(room.id);
              toast.success("Room code copied");
            }}
          >
            Copy
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              if (confirm("Exit this room?")) onExit();
            }}
          >
            Exit
          </Button>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card className="p-3 sm:p-5 flex flex-col items-center justify-center overflow-hidden">
          <ChessStatusBanner
            kind={gameStatus.kind}
            isMyTurn={isMyTurn}
            winnerName={winner?.name ?? null}
            iAmWinner={winner?.id === me.id}
          />
          <ChessBoard
            fen={roomState.fen}
            selectedSquare={selectedSquare}
            legalTargets={legalMoves.map((move) => move.to)}
            lastMove={roomState.lastMove}
            orientation={myChessState?.side === "black" ? "black" : "white"}
            canMove={isMyTurn}
            showCheckBadge={gameStatus.kind === "check"}
            onSquareClick={handleSquareClick}
          />
          <div className="mt-4">
            {isHost && room.status === "waiting" && (
              <Button onClick={startGame} disabled={!canStart || busy} className="h-12">
                Start Game
              </Button>
            )}
            {isHost && room.status === "playing" && (
              <Button onClick={handleRestart} disabled={busy} variant="secondary" className="h-12 mt-2">
                Restart Game
              </Button>
            )}
          </div>
          <ChessGameOverModal
            open={gameStatus.kind === "checkmate" || gameStatus.kind === "stalemate" || gameStatus.kind === "draw"}
            kind={gameStatus.kind}
            winnerName={winner?.name ?? null}
            iAmWinner={winner?.id === me.id}
            isHost={isHost}
            onRestart={handleRestart}
            onExit={onExit}
          />
        </Card>

        <aside className="space-y-4">
          <Card className="p-4">
            <div className="mb-4 rounded-md border border-border bg-muted/40 p-3">
              <div className="text-xs uppercase text-muted-foreground">Chance</div>
              <div className="mt-1 text-lg font-bold text-primary">{turnText}</div>
              <div className="text-xs text-muted-foreground">
                {room.status === "waiting"
                  ? "Waiting for both players"
                  : activePlayer
                    ? `${activePlayer.name} is thinking`
                    : "Waiting for move"}
              </div>
            </div>
            <div className="text-sm font-semibold mb-3">Players</div>
            <ul className="space-y-2">
              {playerStates.map((player) => (
                <li key={player.id} className="flex items-center justify-between gap-3 rounded-md bg-muted/40 px-3 py-2 text-sm">
                  <span className={player.id === me.id ? "text-primary font-semibold" : ""}>
                    {player.name} {player.id === room.host_player_id ? " 👑" : ""}
                  </span>
                  <span className="text-sm text-muted-foreground">{player.side}</span>
                </li>
              ))}
            </ul>
          </Card>

          {spectators.length > 0 && (
            <Card className="p-4">
              <div className="text-sm font-semibold mb-2">Spectators ({spectators.length})</div>
              <ul className="space-y-1 text-sm">
                {spectators.map((s) => (
                  <li key={s.id} className={s.id === me.id ? "text-primary font-semibold" : "text-muted-foreground"}>
                    👁 {s.name}{s.id === me.id ? " (you)" : ""}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <Card className="p-4">
            <div className="text-sm font-semibold mb-3">Move History</div>
            <ul className="space-y-2 text-sm">
              {roomState.moveHistory.length === 0 ? (
                <li className="text-muted-foreground">No moves yet.</li>
              ) : (
                roomState.moveHistory
                  .slice()
                  .reverse()
                  .map((move, index) => (
                    <li key={`${move}-${index}`} className="rounded-md bg-muted/40 px-3 py-2 text-muted-foreground">
                      {roomState.moveHistory.length - index}. {move}
                    </li>
                  ))
              )}
            </ul>
          </Card>
        </aside>
      </div>
    </div>
  );
}

const CHESS_FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const CHESS_RANKS = [8, 7, 6, 5, 4, 3, 2, 1] as const;
const PIECE_GLYPHS: Record<string, string> = {
  wk: "♔",
  wq: "♕",
  wr: "♖",
  wb: "♗",
  wn: "♘",
  wp: "♙",
  bk: "♚",
  bq: "♛",
  br: "♜",
  bb: "♝",
  bn: "♞",
  bp: "♟",
};

function ChessBoard({
  fen,
  selectedSquare,
  legalTargets,
  lastMove,
  orientation,
  canMove,
  showCheckBadge,
  onSquareClick,
}: {
  fen: string;
  selectedSquare: Square | null;
  legalTargets: Square[];
  lastMove: { from: Square; to: Square; san: string } | null;
  orientation: "white" | "black";
  canMove: boolean;
  showCheckBadge: boolean;
  onSquareClick: (square: Square) => void;
}) {
  const [animatingMove, setAnimatingMove] = useState(lastMove);
  const engine = useMemo(() => Chess.createEngine(fen), [fen]);
  const legalSet = useMemo(() => new Set(legalTargets), [legalTargets]);
  const files = orientation === "white" ? CHESS_FILES : [...CHESS_FILES].reverse();
  const ranks = orientation === "white" ? CHESS_RANKS : [...CHESS_RANKS].reverse();

  useEffect(() => {
    if (!lastMove) return;
    setAnimatingMove(lastMove);
    const timeout = window.setTimeout(() => setAnimatingMove(null), 520);
    return () => window.clearTimeout(timeout);
  }, [lastMove?.from, lastMove?.to, lastMove?.san]);

  return (
    <div className="chess-stage">
      <div className="chess-frame">
        <div className="chess-label-row chess-label-row-top">
          {files.map((file) => (
            <span key={`top-${file}`}>{file}</span>
          ))}
        </div>
        <div className="chess-label-row chess-label-row-bottom">
          {files.map((file) => (
            <span key={`bottom-${file}`}>{file}</span>
          ))}
        </div>
        <div className="chess-label-col chess-label-col-left">
          {ranks.map((rank) => (
            <span key={`left-${rank}`}>{rank}</span>
          ))}
        </div>
        <div className="chess-label-col chess-label-col-right">
          {ranks.map((rank) => (
            <span key={`right-${rank}`}>{rank}</span>
          ))}
        </div>
        <div className="chess-board" style={{ cursor: canMove ? "pointer" : "default" }}>
          {ranks.map((rank, row) =>
            files.map((file, col) => {
              const square = `${file}${rank}` as Square;
              const piece = engine.get(square);
              const isLight = (row + col) % 2 === 0;
              const isSelected = selectedSquare === square;
              const isLegal = legalSet.has(square);
              const isLastMove = lastMove?.from === square || lastMove?.to === square;
              const hideStaticPiece = animatingMove?.to === square;
              return (
                <button
                  key={square}
                  type="button"
                  className={`chess-square ${isLight ? "chess-square-light" : "chess-square-dark"} ${
                    isSelected ? "chess-square-selected" : ""
                  } ${isLegal ? "chess-square-legal" : ""} ${isLastMove ? "chess-square-last" : ""}`}
                  onClick={() => onSquareClick(square)}
                  aria-label={piece ? `${piece.color === "w" ? "White" : "Black"} ${piece.type} on ${square}` : square}
                >
                  {isLegal && <span className={piece ? "chess-capture-ring" : "chess-move-dot"} />}
                  {piece && !hideStaticPiece && <ChessPiece piece={piece} />}
                </button>
              );
            }),
          )}
          {animatingMove ? (
            <MovingChessPiece
              move={animatingMove}
              engine={engine}
              files={files}
              ranks={ranks}
            />
          ) : null}
          {showCheckBadge ? (
            <div className="chess-check-badge" role="status" aria-live="polite">
              Check
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ChessStatusBanner({
  kind,
  isMyTurn,
  winnerName,
  iAmWinner,
}: {
  kind: "playing" | "check" | "checkmate" | "stalemate" | "draw";
  isMyTurn: boolean;
  winnerName: string | null;
  iAmWinner: boolean;
}) {
  const [showCheck, setShowCheck] = useState(false);
  useEffect(() => {
    if (kind !== "check") {
      setShowCheck(false);
      return;
    }
    setShowCheck(true);
    const t = window.setTimeout(() => setShowCheck(false), 2500);
    return () => window.clearTimeout(t);
  }, [kind, isMyTurn]);

  if (kind === "checkmate") {
    return (
      <div className="w-full mb-3 rounded-md border border-destructive/40 bg-destructive/15 px-3 py-2 text-center text-sm font-semibold text-destructive">
        Checkmate — {iAmWinner ? "You won!" : winnerName ? `${winnerName} wins` : "Game over"}
      </div>
    );
  }
  if (kind === "stalemate" || kind === "draw") {
    return (
      <div className="w-full mb-3 rounded-md border border-border bg-muted px-3 py-2 text-center text-sm font-semibold">
        {kind === "stalemate" ? "Stalemate" : "Draw"}
      </div>
    );
  }
  if (kind === "check" && showCheck) {
    return (
      <div className="w-full mb-3 rounded-md border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-center text-sm font-semibold text-amber-600 dark:text-amber-400">
        {isMyTurn ? "Your king is in check" : "Opponent is in check"}
      </div>
    );
  }
  return null;
}

function ChessGameOverModal({
  open,
  kind,
  winnerName,
  iAmWinner,
  isHost,
  onRestart,
  onExit,
}: {
  open: boolean;
  kind: "playing" | "check" | "checkmate" | "stalemate" | "draw";
  winnerName: string | null;
  iAmWinner: boolean;
  isHost: boolean;
  onRestart: () => void;
  onExit: () => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!open) setDismissed(false);
  }, [open]);
  const isOpen = open && !dismissed;
  const title =
    kind === "checkmate"
      ? iAmWinner
        ? "Checkmate — You won!"
        : `Checkmate — ${winnerName ?? "Opponent"} wins`
      : kind === "stalemate"
        ? "Stalemate"
        : "Draw";
  return (
    <AlertDialog open={isOpen} onOpenChange={(v) => !v && setDismissed(true)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>
            {kind === "checkmate"
              ? "The game has ended. You can close this to keep viewing the final board."
              : "The game has ended without a winner."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => setDismissed(true)}>Close</AlertDialogCancel>
          {isHost ? (
            <AlertDialogAction onClick={() => { setDismissed(true); onRestart(); }}>
              New Game
            </AlertDialogAction>
          ) : null}
          <AlertDialogAction onClick={onExit}>Exit Room</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ChessPiece({ piece }: { piece: { color: "w" | "b"; type: string } }) {
  return (
    <span className={`chess-piece chess-piece-${piece.color}`}>
      {PIECE_GLYPHS[`${piece.color}${piece.type}`]}
    </span>
  );
}

function MovingChessPiece({
  move,
  engine,
  files,
  ranks,
}: {
  move: { from: Square; to: Square; san: string };
  engine: ReturnType<typeof Chess.createEngine>;
  files: readonly string[];
  ranks: readonly number[];
}) {
  const piece = engine.get(move.to);
  if (!piece) return null;
  const from = squarePosition(move.from, files, ranks);
  const to = squarePosition(move.to, files, ranks);
  return (
    <div
      className="chess-moving-piece"
      style={
        {
          "--from-x": `${from.x}%`,
          "--from-y": `${from.y}%`,
          "--to-x": `${to.x}%`,
          "--to-y": `${to.y}%`,
        } as CSSProperties
      }
      aria-hidden
    >
      <ChessPiece piece={piece} />
    </div>
  );
}

function squarePosition(square: Square, files: readonly string[], ranks: readonly number[]) {
  const file = square[0];
  const rank = Number(square[1]);
  const col = files.indexOf(file);
  const row = ranks.indexOf(rank);
  return {
    x: col * 100,
    y: row * 100,
  };
}
