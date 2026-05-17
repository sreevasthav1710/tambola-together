// Tiny localStorage helper so a player remembers their identity per room.
const KEY = "tambola.players";

type Store = Record<string, { playerId: string; name: string }>; // roomId -> identity

function read(): Store {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}");
  } catch {
    return {};
  }
}

function write(s: Store) {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function getIdentity(roomId: string) {
  return read()[roomId];
}

export function setIdentity(roomId: string, playerId: string, name: string) {
  const s = read();
  s[roomId] = { playerId, name };
  write(s);
}

export function clearIdentity(roomId: string) {
  const s = read();
  delete s[roomId];
  write(s);
}
