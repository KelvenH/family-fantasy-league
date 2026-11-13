export type Position = "GK" | "DEF" | "MID" | "STR";

export type Player = {
  id: number;
  name: string;
  pos: Position;
  club: string;
  price: number;
  pts: number;
};

export type TeamStanding = {
  id: number;
  name: string;
  totalPts: number;
  totalPrice: number;
  rank: number;
};

export type TeamSlot = {
  slotIndex: number;
  slotPos: Position;
  playerId: number | null;
  playerName: string | null;
  club: string | null;
  price: number | null;
  pts: number | null;
};

export type TeamDetail = {
  id: number;
  name: string;
  totalPts: number;
  totalPrice: number;
  slots: TeamSlot[];
};

export const SLOT_POSITIONS: Position[] = [
  "GK",
  "DEF",
  "DEF",
  "DEF",
  "DEF",
  "MID",
  "MID",
  "MID",
  "MID",
  "STR",
  "STR",
];

export const POS_ORDER: Record<string, number> = {
  GK: 0,
  DEF: 1,
  MID: 2,
  STR: 3,
};
