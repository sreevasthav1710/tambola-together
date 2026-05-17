import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { generateRoomCode, generateTicket } from "@/lib/tambola";
import { setIdentity } from "@/lib/playerStore";

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
    (Number(char) ^ (Math.random() * 16) >> (Number(char) / 4)).toString(16),
  );
}

function Home() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10 bg-gradient-to-br from-[oklch(0.18_0.04_290)] via-[oklch(0.22_0.06_290)] to-[oklch(0.14_0.04_290)]">
      <div className="text-center mb-10">
        <div className="text-6xl mb-3">🎱</div>
        <h1 className="text-5xl md:text-6xl font-bold text-primary tracking-tight">Tambola Live</h1>
        <p className="text-muted-foreground mt-3 text-lg">Play Housie with friends — anywhere.</p>
      </div>

      <Card className="w-full max-w-md p-6 space-y-3">
        <CreateRoomDialog />
        <JoinRoomDialog />
      </Card>

      <p className="text-xs text-muted-foreground mt-8 max-w-md text-center">
        Share the room code with friends. Host calls numbers; players mark their tickets and claim prizes.
      </p>
    </div>
  );
}

function CreateRoomDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ff, setFf] = useState(50);
  const [l1, setL1] = useState(50);
  const [l2, setL2] = useState(50);
  const [l3, setL3] = useState(50);
  const [housie, setHousie] = useState(200);
  const [housiesAllowed, setHousiesAllowed] = useState(1);
  const [busy, setBusy] = useState(false);

  async function handleCreate() {
    if (!name.trim()) return toast.error("Please enter your name");
    setBusy(true);
    try {
      const roomId = generateRoomCode();
      const playerId = createPlayerId();
      const ticket = generateTicket();

      const { error: rErr } = await supabase.from("rooms").insert({
        id: roomId,
        host_player_id: playerId,
        host_name: name.trim(),
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
        name: name.trim(),
        ticket: ticket as never,
      });
      if (pErr) throw pErr;

      setIdentity(roomId, playerId, name.trim());
      toast.success(`Room ${roomId} created`);
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
        <Button size="lg" className="w-full text-lg h-14">Create Room</Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Create a new room</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Your display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Host name" />
          </div>
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
          <Button onClick={handleCreate} disabled={busy} className="w-full">
            {busy ? "Creating..." : "Create Room"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrizeInput({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
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

function JoinRoomDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleJoin() {
    const roomId = code.trim().toUpperCase();
    if (!roomId) return toast.error("Enter a room code");
    if (!name.trim()) return toast.error("Enter your name");
    setBusy(true);
    try {
      const { data: room, error: rErr } = await supabase
        .from("rooms")
        .select("id,status")
        .eq("id", roomId)
        .maybeSingle();
      if (rErr) throw rErr;
      if (!room) return toast.error("Room not found");
      if (room.status === "ended") return toast.error("This game has ended");

      const playerId = createPlayerId();
      const ticket = generateTicket();
      const { error: pErr } = await supabase.from("players").insert({
        id: playerId,
        room_id: roomId,
        name: name.trim(),
        ticket: ticket as never,
      });
      if (pErr) throw pErr;

      setIdentity(roomId, playerId, name.trim());
      navigate({ to: "/room/$roomId", params: { roomId } });
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
        <Button size="lg" variant="secondary" className="w-full text-lg h-14">Join Room</Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join a room</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label>Room code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. AB23CD" maxLength={6} />
          </div>
          <div>
            <Label>Your display name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
          </div>
          <Button onClick={handleJoin} disabled={busy} className="w-full">
            {busy ? "Joining..." : "Join"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
