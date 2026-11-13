/**
 * Reads the Dream Team fantasy game's public player list. The address is
 * fixed here — visitors can never change where the server fetches from.
 */
const DREAM_TEAM_PLAYERS_URL =
  "https://engagecraft-fantasy-backend-prod.azurewebsites.net/api/players?type=gameweek";
const TIMEOUT_MS = 15_000;
const MAX_BYTES = 5 * 1024 * 1024;

export type DreamTeamPlayer = {
  names: string[];
  club: string;
  position: string;
  totalPoints: number;
};

export type DreamTeamErrorKind = "unreachable" | "bad_response";

export class DreamTeamError extends Error {
  constructor(
    readonly kind: DreamTeamErrorKind,
    message: string,
  ) {
    super(message);
  }
}

async function readCapped(response: Response): Promise<string> {
  if (!response.body) throw new DreamTeamError("bad_response", "Empty response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw new DreamTeamError("bad_response", "Response too large");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function asPlayer(raw: unknown): DreamTeamPlayer | null {
  if (!raw || typeof raw !== "object") return null;
  const item = raw as Record<string, unknown>;
  const names = [item.displayName, item.matchName].filter(
    (value): value is string => typeof value === "string" && value !== "",
  );
  const club = item.shirtKey;
  const position = item.position;
  const totalPoints = item.totalPoints;
  if (
    names.length === 0 ||
    typeof club !== "string" ||
    typeof position !== "string" ||
    typeof totalPoints !== "number" ||
    !Number.isInteger(totalPoints)
  ) {
    return null;
  }
  return { names, club, position, totalPoints };
}

export async function fetchDreamTeamPlayers(): Promise<DreamTeamPlayer[]> {
  let response: Response;
  try {
    response = await fetch(DREAM_TEAM_PLAYERS_URL, {
      headers: { accept: "application/json" },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new DreamTeamError("unreachable", "Could not reach Dream Team");
  }
  if (!response.ok) {
    throw new DreamTeamError(
      response.status >= 500 ? "unreachable" : "bad_response",
      `Dream Team answered ${response.status}`,
    );
  }

  let body: unknown;
  try {
    body = JSON.parse(await readCapped(response));
  } catch (error) {
    if (error instanceof DreamTeamError) throw error;
    throw new DreamTeamError("bad_response", "Response was not JSON");
  }

  const items = (body as { data?: { items?: unknown } })?.data?.items;
  if (!Array.isArray(items)) {
    throw new DreamTeamError("bad_response", "Unexpected response shape");
  }
  const players = items
    .map(asPlayer)
    .filter((p): p is DreamTeamPlayer => p !== null);
  if (players.length === 0) {
    throw new DreamTeamError("bad_response", "No players in response");
  }
  return players;
}
