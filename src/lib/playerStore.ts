// Tiny localStorage helper so a player remembers their identity per room and profile defaults.
const KEY = "tambola.players";
const PROFILE_KEY = "tambola.profile";

type Store = Record<string, { playerId: string; name: string }>; // roomId -> identity
type Profile = { displayName: string; color: string };

const DEFAULT_PROFILE: Profile = {
  displayName: "",
  color: "oklch(0.85 0.15 85)",
};

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

export function getProfile(): Profile {
  if (typeof window === "undefined") return DEFAULT_PROFILE;
  try {
    return { ...DEFAULT_PROFILE, ...JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}") };
  } catch {
    return DEFAULT_PROFILE;
  }
}

export function setProfile(profile: Profile) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
}
