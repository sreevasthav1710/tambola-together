import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getIdentity, clearIdentity } from "@/lib/playerStore";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TambolaTicket } from "@/components/TambolaTicket";
import {
  validateClaim, CLAIM_LABELS, type ClaimType, type Ticket,
} from "@/lib/tambola";

interface RoomRow {
  id: string;
  host_player_id: string;
  host_name: string;
  prize_ff: number;
  prize_line1: number;
  prize_line2: number;
  prize_line3: number;
  prize_housie: number;
  housies_allowed: number;
  called_numbers: number[];
  housies_won: number;
  claimed: Record<string, string | string[]>;
  status: string;
}

interface PlayerRow {
  id: string;
  room_id: string;
  name: string;
  ticket: Ticket;
  marked_numbers: number[];
  purse: number;
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
  const [exitOpen, setExitOpen] = useState(false);

  // Redirect home if no identity for this room.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!identity) navigate({ to: "/" });
  }, [identity, navigate]);

  // Initial load.
  useEffect(() => {
    let cancel = false;
    async function load() {
      const [{ data: r }, { data: ps }] = await Promise.all([
        supabase.from("rooms").select("*").eq("id", roomId).maybeSingle(),
        supabase.from("players").select("*").eq("room_id", roomId).order("joined_at"),
      ]);
      if (cancel) return;
      if (r) setRoom(r as unknown as RoomRow);
      if (ps) setPlayers(ps as unknown as PlayerRow[]);
      setLoading(false);
    }
    load();
    return () => { cancel = true; };
  }, [roomId]);

  // Realtime.
  useEffect(() => {
    const ch = supabase
      .channel(`room-${roomId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          if (payload.eventType === "DELETE") setRoom(null);
          else setRoom(payload.new as unknown as RoomRow);
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        (payload) => {
          setPlayers((prev) => {
            if (payload.eventType === "INSERT") {
              const np = payload.new as unknown as PlayerRow;
              if (prev.some((p) => p.id === np.id)) return prev;
              return [...prev, np];
            }
            if (payload.eventType === "UPDATE") {
              const np = payload.new as unknown as PlayerRow;
              return prev.map((p) => (p.id === np.id ? np : p));
            }
            if (payload.eventType === "DELETE") {
              const op = payload.old as unknown as PlayerRow;
              return prev.filter((p) => p.id !== op.id);
            }
            return prev;
          });
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [roomId]);

  const me = useMemo(
    () => (identity ? players.find((p) => p.id === identity.playerId) : undefined),
    [players, identity],
  );
  const isHost = !!(room && identity && room.host_player_id === identity.playerId);
  const called = useMemo(() => new Set(room?.called_numbers ?? []), [room]);
  const marked = useMemo(() => new Set(me?.marked_numbers ?? []), [me]);

  const handleCellClick = useCallback(async (n: number) => {
    if (!me || !room) return;
    if (room.status === "ended") return;
    if (!called.has(n)) {
      toast.error("Number has not arrived yet");
      return;
    }
    const isMarked = marked.has(n);
    const next = isMarked ? me.marked_numbers.filter((x) => x !== n) : [...me.marked_numbers, n];
    setPlayers((prev) => prev.map((p) => (p.id === me.id ? { ...p, marked_numbers: next } : p)));
    const { error } = await supabase.from("players").update({ marked_numbers: next }).eq("id", me.id);
    if (error) toast.error(error.message);
  }, [me, room, called, marked]);

  const handleNextNumber = useCallback(async () => {
    if (!room || !isHost) return;
    if (room.status === "ended") return;
    const all = Array.from({ length: 90 }, (_, i) => i + 1);
    const remaining = all.filter((n) => !called.has(n));
    if (remaining.length === 0) return toast.error("All numbers called");
    const pick = remaining[Math.floor(Math.random() * remaining.length)];
    const newCalled = [...room.called_numbers, pick];
    const updates: Partial<RoomRow> = { called_numbers: newCalled };
    if (room.status === "waiting") updates.status = "playing";
    const { error } = await supabase.from("rooms").update(updates).eq("id", room.id);
    if (error) toast.error(error.message);
  }, [room, isHost, called]);

  const handleClaim = useCallback(async (type: ClaimType) => {
    if (!me || !room) return;
    if (room.status !== "playing" && room.status !== "waiting") return;

    const result = validateClaim(type, me.ticket, room.called_numbers, me.marked_numbers);
    const prize =
      type === "ff" ? room.prize_ff :
      type === "line1" ? room.prize_line1 :
      type === "line2" ? room.prize_line2 :
      type === "line3" ? room.prize_line3 :
      room.prize_housie;
    const claimed = { ...(room.claimed || {}) };

    if (!result.ok) {
      // bogey - deduct prize
      const newPurse = me.purse - prize;
      await supabase.from("players").update({ purse: newPurse }).eq("id", me.id);
      toast.error(`Bogey! ${result.reason}. -${prize} from your purse.`);
      return;
    }

    // Already claimed?
    if (type === "housie") {
      const prev = Array.isArray(claimed.housie) ? claimed.housie : [];
      if (prev.includes(me.id)) return toast.error("You already claimed Housie");
      if (prev.length >= room.housies_allowed) return toast.error("All Housies already claimed");
      claimed.housie = [...prev, me.id];
    } else {
      if (claimed[type]) return toast.error(`${CLAIM_LABELS[type]} already claimed`);
      claimed[type] = me.id;
    }

    const newPurse = me.purse + prize;
    const newHousiesWon = type === "housie" ? room.housies_won + 1 : room.housies_won;
    const newStatus = type === "housie" && newHousiesWon >= room.housies_allowed ? "ended" : room.status;

    const [r1, r2] = await Promise.all([
      supabase.from("rooms").update({
        claimed: claimed as never,
        housies_won: newHousiesWon,
        status: newStatus,
      }).eq("id", room.id),
      supabase.from("players").update({ purse: newPurse }).eq("id", me.id),
    ]);
    if (r1.error || r2.error) {
      toast.error((r1.error || r2.error)!.message);
      return;
    }
    toast.success(`🎉 ${CLAIM_LABELS[type]}! +${prize}`);
  }, [me, room]);

  function handleExit() {
    if (!identity) { navigate({ to: "/" }); return; }
    clearIdentity(roomId);
    // Remove the player record (only if not host or game ended).
    supabase.from("players").delete().eq("id", identity.playerId).then(() => {
      navigate({ to: "/" });
    });
  }

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading room…</div>;
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

  const lastNumber = room.called_numbers[room.called_numbers.length - 1];

  return (
    <div className="min-h-screen px-4 py-6 max-w-7xl mx-auto">
      <header className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-primary">Room {room.id}</h1>
          <p className="text-sm text-muted-foreground">
            Host: {room.host_name} {isHost && "(you)"} · {players.length} player{players.length !== 1 && "s"} · Housie {room.housies_won}/{room.housies_allowed}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => {
            navigator.clipboard.writeText(room.id);
            toast.success("Room code copied");
          }}>Copy code</Button>
          <Button variant="destructive" size="sm" onClick={() => setExitOpen(true)}>Exit</Button>
        </div>
      </header>

      {room.status === "ended" ? (
        <Leaderboard room={room} players={players} />
      ) : (
        <div className="grid md:grid-cols-[1fr_360px] gap-6">
          <div className="space-y-6">
            {/* Last number + controls */}
            <Card className="p-5 flex flex-col sm:flex-row items-center gap-5">
              <div className="flex items-center gap-4">
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Last Number</div>
                  <div className="number-ball number-ball-called w-24 h-24 text-4xl">
                    {lastNumber ?? "—"}
                  </div>
                </div>
                <div className="text-center">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1">Called</div>
                  <div className="text-3xl font-bold">{room.called_numbers.length}/90</div>
                </div>
              </div>
              <div className="flex-1 w-full sm:w-auto">
                {isHost ? (
                  <Button onClick={handleNextNumber} size="lg" className="w-full h-16 text-xl">
                    🎲 Next Number
                  </Button>
                ) : (
                  <p className="text-sm text-muted-foreground text-center">
                    Waiting for host to call the next number…
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

            {/* Claim buttons */}
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Claim a prize</div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <ClaimBtn label="Fastest 5" prize={room.prize_ff} disabled={!!room.claimed.ff} onClick={() => handleClaim("ff")} />
                <ClaimBtn label="Top Line" prize={room.prize_line1} disabled={!!room.claimed.line1} onClick={() => handleClaim("line1")} />
                <ClaimBtn label="Middle" prize={room.prize_line2} disabled={!!room.claimed.line2} onClick={() => handleClaim("line2")} />
                <ClaimBtn label="Bottom" prize={room.prize_line3} disabled={!!room.claimed.line3} onClick={() => handleClaim("line3")} />
                <ClaimBtn label="Housie" prize={room.prize_housie} disabled={room.housies_won >= room.housies_allowed} onClick={() => handleClaim("housie")} />
              </div>
              <p className="text-xs text-muted-foreground mt-2">
                Bogey calls deduct the prize amount from your purse. Your purse: <span className="text-primary font-semibold">{me.purse}</span>
              </p>
            </Card>

            {/* Called numbers board */}
            <Card className="p-4">
              <div className="text-sm font-semibold mb-3">Called Numbers</div>
              <div className="grid grid-cols-10 gap-1.5">
                {Array.from({ length: 90 }, (_, i) => i + 1).map((n) => {
                  const c = called.has(n);
                  return (
                    <div
                      key={n}
                      className={`aspect-square rounded flex items-center justify-center text-xs font-bold ${
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
            <AlertDialogAction onClick={() => {
              setExitOpen(false);
              setTimeout(() => {
                if (confirm("Really exit? This cannot be undone.")) handleExit();
              }, 100);
            }}>Exit</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ClaimBtn({ label, prize, disabled, onClick }: { label: string; prize: number; disabled?: boolean; onClick: () => void }) {
  return (
    <Button variant={disabled ? "secondary" : "default"} disabled={disabled} onClick={onClick} className="h-auto py-2 flex-col">
      <span className="text-xs">{label}</span>
      <span className="text-sm font-bold">{prize}</span>
    </Button>
  );
}

function ClaimedRow({ label, claim, players }: { label: string; claim: string | string[] | undefined; players: PlayerRow[] }) {
  function nameOf(id: string) { return players.find((p) => p.id === id)?.name ?? "—"; }
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
              <span className="text-2xl">{["🥇","🥈","🥉"][i] ?? `#${i+1}`}</span>
              {p.name}
            </span>
            <span className="text-xl font-bold">{p.purse}</span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
