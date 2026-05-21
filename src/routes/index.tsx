import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Dice5, Lock, RefreshCw, Ticket, UserRound } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { supabase } from "@/integrations/supabase/client";
import { generateRoomCode, generateTicket } from "@/lib/tambola";
import { getProfile, setIdentity, setProfile } from "@/lib/playerStore";
import {
  PLAYER_COLORS,
  createInitialRoomState,
  createPlayerState,
  MAX_PLAYERS,
} from "@/lib/snakeLadder";

type GameType = "tambola" | "snake-ladder";

const GAME_META: Record<GameType, { title: string; description: string; icon: typeof Ticket }> = {
  tambola: {
    title: "Tambola",
    description: "Classic Housie tickets, live number calls, automatic prize checks.",
    icon: Ticket,
  },
  "snake-ladder": {
    title: "Snake N Ladder",
    description: "2-6 players, turn-based dice rolls, snakes, ladders, and realtime board sync.",
    icon: Dice5,
  },
};

export const Route = createFileRoute("/")({
  component: Home,
});

function createPlayerId() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }

  if (typeof cryptoApi?.getRandomValues === "function") {
    const bytes = cryptoApi.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;

    return [...bytes]
      .map((byte, index) => {
        const value = byte.toString(16).padStart(2, "0");
        return [4, 6, 8, 10].includes(index) ? `-${value}` : value;
      })
      .join("");
  }

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (char) =>
    (Number(char) ^ ((Math.random() * 16) >> (Number(char) / 4))).toString(16),
  );
}

function Home() {
  const [displayName, setDisplayName] = useState("");
  const [selectedGame, setSelectedGame] = useState<GameType | null>(null);
  const selectedMeta = selectedGame ? GAME_META[selectedGame] : null;

  useEffect(() => {
    const profile = getProfile();
    setDisplayName(profile.displayName);
  }, []);

  function saveProfile(nextName: string) {
    const trimmed = nextName.trim();
    setDisplayName(trimmed);
    setProfile({ displayName: trimmed, color: PLAYER_COLORS[0] });
    toast.success("Profile updated");
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-br from-[oklch(0.18_0.04_290)] via-[oklch(0.22_0.06_290)] to-[oklch(0.14_0.04_290)]">
      <div className="fixed right-4 top-4 z-10">
        <ProfileDialog displayName={displayName} onSave={saveProfile} />
      </div>

      {selectedGame && selectedMeta ? (
        <GameActionScreen
          displayName={displayName}
          gameType={selectedGame}
          onBack={() => setSelectedGame(null)}
        />
      ) : (
        <GameSelectionScreen onSelect={setSelectedGame} />
      )}
    </div>
  );
}

function GameSelectionScreen({ onSelect }: { onSelect: (gameType: GameType) => void }) {
  return (
    <>
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">GameHub</div>
        <h1 className="text-5xl md:text-6xl font-bold text-primary tracking-tight">Game Lobby</h1>
        <p className="text-muted-foreground mt-3 text-lg">Select a game to continue.</p>
      </div>

      <div className="grid w-full max-w-4xl gap-4 md:grid-cols-2">
        {(Object.keys(GAME_META) as GameType[]).map((gameType) => {
          const meta = GAME_META[gameType];
          const Icon = meta.icon;
          return (
            <button
              key={gameType}
              type="button"
              onClick={() => onSelect(gameType)}
              className="rounded-xl border border-border bg-card p-5 text-left transition hover:border-primary/70 hover:shadow-[0_0_0_2px_oklch(0.85_0.15_85_/_0.16)]"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/15 p-3 text-primary">
                  <Icon className="h-7 w-7" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold">{meta.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{meta.description}</p>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function GameActionScreen({
  displayName,
  gameType,
  onBack,
}: {
  displayName: string;
  gameType: GameType;
  onBack: () => void;
}) {
  const meta = GAME_META[gameType];

  return (
    <>
      <div className="w-full max-w-md">
        <Button variant="ghost" className="mb-6 gap-2" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
          Games
        </Button>
      </div>

      <div className="text-center mb-10">
        <h1 className="text-5xl md:text-6xl font-bold text-primary tracking-tight">
          {meta.title}
        </h1>
        <p className="text-muted-foreground mt-3 text-lg">{meta.description}</p>
      </div>

      <Card className="w-full max-w-md p-6 space-y-3">
        <CreateRoomDialog displayName={displayName} gameType={gameType} />
        <JoinRoomDialog displayName={displayName} gameType={gameType} />
      </Card>

      <p className="text-xs text-muted-foreground mt-8 max-w-md text-center">
        Create named rooms, choose public or private access, and join with your saved profile name.
      </p>
    </>
  );
}

function ProfileDialog({
  displayName,
  onSave,
}: {
  displayName: string;
  onSave: (name: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(displayName);

  useEffect(() => {
    if (!open) return;
    setDraft(displayName);
  }, [displayName, open]);

  function handleSave() {
    if (!draft.trim()) return toast.error("Enter a display name");
    onSave(draft);
    setOpen(false);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" aria-label="Edit profile">
          <UserRound className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Profile</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Default display name</Label>
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Your name"
            />
          </div>
          <Button onClick={handleSave} className="w-full">
            Save Profile
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CreateRoomDialog({
  displayName,
  gameType,
}: {
  displayName: string;
  gameType: GameType;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [visibility, setVisibility] = useState<"public" | "private">("public");
  const [pin, setPin] = useState("");
  const [ff, setFf] = useState(50);
  const [l1, setL1] = useState(50);
  const [l2, setL2] = useState(50);
  const [l3, setL3] = useState(50);
  const [housie, setHousie] = useState(200);
  const [housiesAllowed, setHousiesAllowed] = useState(1);
  const [snakeColor, setSnakeColor] = useState(PLAYER_COLORS[0]);
  const [busy, setBusy] = useState(false);
  const roomNamePlaceholder =
    gameType === "snake-ladder" ? "Snake Ladder Challenge" : "Friday Housie Night";

  async function handleCreate() {
    const hostName = displayName.trim();
    const cleanRoomName = roomName.trim();
    const cleanPin = pin.trim();
    if (!hostName) return toast.error("Set your profile display name first");
    if (!cleanRoomName) return toast.error("Enter a room name");
    if (visibility === "private" && !cleanPin) return toast.error("Set a private room PIN");

    setBusy(true);
    try {
      const roomId = generateRoomCode();
      const playerId = createPlayerId();
      const ticket = generateTicket();
      const isSnakeLadder = gameType === "snake-ladder";
      const playerGameState = isSnakeLadder
        ? createPlayerState(playerId, hostName, 0, snakeColor)
        : {};

      const { error: rErr } = await supabase.from("rooms").insert({
        id: roomId,
        host_player_id: playerId,
        host_name: hostName,
        room_name: cleanRoomName,
        game_type: gameType,
        game_state: isSnakeLadder ? (createInitialRoomState() as never) : {},
        visibility,
        pin: visibility === "private" ? cleanPin : null,
        prize_ff: ff,
        prize_line1: l1,
        prize_line2: l2,
        prize_line3: l3,
        prize_housie: housie,
        housies_allowed: housiesAllowed,
      });
      if (rErr) throw rErr;

      const { error: pErr } = await supabase.from("players").insert({
        id: playerId,
        room_id: roomId,
        name: hostName,
        ticket: ticket as never,
        game_state: playerGameState as never,
      });
      if (pErr) throw pErr;

      setIdentity(roomId, playerId, hostName);
      toast.success(`${cleanRoomName} created`);
      navigate({ to: "/room/$roomId", params: { roomId } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to create room";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" className="w-full text-lg h-14">
          Create {GAME_META[gameType].title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new room</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Room name</Label>
            <Input
              value={roomName}
              onChange={(e) => setRoomName(e.target.value)}
              placeholder={roomNamePlaceholder}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant={visibility === "public" ? "default" : "outline"}
              onClick={() => setVisibility("public")}
            >
              Public
            </Button>
            <Button
              type="button"
              variant={visibility === "private" ? "default" : "outline"}
              onClick={() => setVisibility("private")}
            >
              Private
            </Button>
          </div>
          {visibility === "private" && (
            <div>
              <Label>Room PIN</Label>
              <Input
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Set a PIN"
                type="password"
              />
            </div>
          )}
          {gameType === "tambola" ? (
            <div className="grid grid-cols-2 gap-3">
              <PrizeInput label="Fastest Five" value={ff} onChange={setFf} />
              <PrizeInput label="Top Line" value={l1} onChange={setL1} />
              <PrizeInput label="Middle Line" value={l2} onChange={setL2} />
              <PrizeInput label="Bottom Line" value={l3} onChange={setL3} />
              <PrizeInput label="Housie (each)" value={housie} onChange={setHousie} />
              <div>
                <Label>Housies allowed</Label>
                <Input
                  type="number"
                  min={1}
                  value={housiesAllowed}
                  onChange={(e) => setHousiesAllowed(Math.max(1, Number(e.target.value) || 1))}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <ColorPicker
                selectedColor={snakeColor}
                takenColors={[]}
                onSelect={setSnakeColor}
              />
              <div className="rounded-md border border-border bg-muted/40 p-3 text-sm text-muted-foreground">
                Snake N Ladder rooms allow 2-6 players. The host starts the game after players join.
              </div>
            </div>
          )}
          <Button onClick={handleCreate} disabled={busy} className="w-full">
            {busy ? "Creating..." : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrizeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        min={0}
        value={value}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
      />
    </div>
  );
}

function ColorPicker({
  selectedColor,
  takenColors,
  onSelect,
}: {
  selectedColor: string;
  takenColors: string[];
  onSelect: (color: string) => void;
}) {
  return (
    <div>
      <Label>Player color</Label>
      <div className="mt-2 grid grid-cols-6 gap-2">
        {PLAYER_COLORS.map((color) => {
          const disabled = takenColors.includes(color);
          return (
            <button
              key={color}
              type="button"
              disabled={disabled}
              className={`h-9 rounded-md border-2 border-white/80 shadow-sm transition disabled:cursor-not-allowed disabled:opacity-30 ${
                selectedColor === color && !disabled
                  ? "ring-2 ring-primary ring-offset-2 ring-offset-card"
                  : ""
              }`}
              style={{ background: color }}
              aria-label={disabled ? "Color already taken" : `Use color ${color}`}
              onClick={() => onSelect(color)}
            />
          );
        })}
      </div>
    </div>
  );
}

function takenColorsFor(room: Pick<LobbyRoom, "players">): string[] {
  return (room.players ?? [])
    .map((player) =>
      player.game_state && typeof player.game_state === "object" ? player.game_state.color : null,
    )
    .filter((color): color is string => typeof color === "string");
}

type LobbyRoom = {
  id: string;
  room_name: string;
  game_type: GameType;
  host_name: string;
  visibility: string;
  pin: string | null;
  status: string;
  created_at: string;
  players?: { id: string; name?: string; game_state?: { color?: string } | null }[];
};

function JoinRoomDialog({
  displayName,
  gameType,
}: {
  displayName: string;
  gameType: GameType;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [rooms, setRooms] = useState<LobbyRoom[]>([]);
  const [selectedRoom, setSelectedRoom] = useState<LobbyRoom | null>(null);
  const [pin, setPin] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [selectedColor, setSelectedColor] = useState(PLAYER_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void loadRooms();
  }, [open, gameType]);

  async function loadRooms() {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("rooms")
        .select(
          "id,room_name,game_type,host_name,visibility,pin,status,created_at,players!inner(id,name,game_state)",
        )
        .in("status", ["waiting", "playing"])
        .eq("game_type", gameType)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const openRooms = ((data ?? []) as LobbyRoom[]).filter((room) => {
        if ((room.players?.length ?? 0) === 0) return false;
        return room.game_type !== "snake-ladder" || room.status === "waiting";
      });
      setRooms(openRooms);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to load rooms";
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  }

  function requestJoin(room: LobbyRoom) {
    if (!displayName.trim()) return toast.error("Set your profile display name first");
    setSelectedRoom(room);
    if (room.visibility === "private" && pin.trim() !== (room.pin ?? "")) {
      return toast.error("Enter the correct private room PIN");
    }
    if (room.game_type === "snake-ladder") {
      const availableColor = PLAYER_COLORS.find((color) => !takenColorsFor(room).includes(color));
      if (!availableColor) return toast.error("All player colors are taken");
      setSelectedColor(availableColor);
    }
    setConfirmOpen(true);
  }

  async function handleJoin() {
    const room = selectedRoom;
    const playerName = displayName.trim();
    if (!room) return;
    if (!playerName) return toast.error("Set your profile display name first");

    setBusy(true);
    try {
      const { data: freshRoom, error: rErr } = await supabase
        .from("rooms")
        .select("id,status,players(id,name,game_state)")
        .eq("id", room.id)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!freshRoom) return toast.error("Room not found");
      if (freshRoom.status === "ended") return toast.error("This game has ended");
      if (freshRoom.status === "stopped") return toast.error("This room is stopped");
      if (!["waiting", "playing"].includes(freshRoom.status))
        return toast.error("This room is not open");
      if (room.game_type === "snake-ladder" && freshRoom.status !== "waiting") {
        return toast.error("Snake N Ladder has already started");
      }
      const currentPlayers = (freshRoom as unknown as LobbyRoom).players ?? [];
      if (currentPlayers.length === 0) return toast.error("This room is empty");
      if (room.game_type === "snake-ladder" && currentPlayers.length >= MAX_PLAYERS) {
        return toast.error("This Snake N Ladder room is full");
      }
      if (room.game_type === "snake-ladder") {
        const takenColors = takenColorsFor({ ...room, players: currentPlayers });
        if (takenColors.includes(selectedColor)) {
          return toast.error("That color is already taken in this room");
        }
      }
      if (
        currentPlayers.some(
          (player) => player.name?.trim().toLowerCase() === playerName.toLowerCase(),
        )
      ) {
        return toast.error("That display name is already in this room");
      }

      const playerId = createPlayerId();
      const ticket = generateTicket();
      const playerGameState =
        room.game_type === "snake-ladder"
          ? createPlayerState(playerId, playerName, currentPlayers.length, selectedColor)
          : {};
      const { error: pErr } = await supabase.from("players").insert({
        id: playerId,
        room_id: room.id,
        name: playerName,
        ticket: ticket as never,
        game_state: playerGameState as never,
      });
      if (pErr) {
        if (pErr.code === "23505") {
          return toast.error("That display name is already in this room");
        }
        throw pErr;
      }

      setIdentity(room.id, playerId, playerName);
      navigate({ to: "/room/$roomId", params: { roomId: room.id } });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to join";
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="lg" variant="secondary" className="w-full text-lg h-14">
          Join {GAME_META[gameType].title}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Open {GAME_META[gameType].title} rooms</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-muted-foreground">
              Joining as{" "}
              <span className="font-semibold text-foreground">
                {displayName || "Profile name missing"}
              </span>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={loadRooms}
              disabled={loading}
              aria-label="Refresh rooms"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto pr-1">
            {loading ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                Loading rooms...
              </div>
            ) : rooms.length === 0 ? (
              <div className="rounded-md border border-border p-4 text-sm text-muted-foreground">
                No open rooms right now.
              </div>
            ) : (
              rooms.map((room) => (
                <div key={room.id} className="rounded-md border border-border bg-card p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-semibold">
                          {room.room_name || `Room ${room.id}`}
                        </div>
                        {room.visibility === "private" && (
                          <Lock className="h-4 w-4 text-muted-foreground" />
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {GAME_META[room.game_type].title} - Code {room.id} - Host {room.host_name} -{" "}
                        {room.status}
                      </div>
                    </div>
                    <Button type="button" size="sm" onClick={() => requestJoin(room)}>
                      Join
                    </Button>
                  </div>
                  {selectedRoom?.id === room.id && room.visibility === "private" && (
                    <div className="mt-3">
                      <Label>Private room PIN</Label>
                      <Input
                        value={pin}
                        onChange={(e) => setPin(e.target.value)}
                        placeholder="Enter PIN"
                        type="password"
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </DialogContent>
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Join {selectedRoom?.room_name || "this room"}?</AlertDialogTitle>
            <AlertDialogDescription>
              You will enter as {displayName || "your profile name"} and join{" "}
              {selectedRoom ? GAME_META[selectedRoom.game_type].title : "the game"}.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {selectedRoom?.game_type === "snake-ladder" && (
            <ColorPicker
              selectedColor={selectedColor}
              takenColors={takenColorsFor(selectedRoom)}
              onSelect={setSelectedColor}
            />
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleJoin} disabled={busy}>
              {busy ? "Joining..." : "Join Room"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
