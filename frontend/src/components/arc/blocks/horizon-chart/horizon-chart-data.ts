export interface HorizonSeries {
  /** Stable id, used for keys and callbacks. */
  id: string;
  /** Row label. */
  name: string;
  /** One value per day, as a percentage away from the baseline (12 means 12% above, -8 means 8% below). */
  values: number[];
}

export interface HorizonDay {
  /** Compact label, such as "Aug 11". */
  short: string;
  /** Full label for the readout and screen readers, such as "Tuesday, August 11". */
  long: string;
}

export type HorizonSort = "name" | "peak" | "latest";

const monthsShort = ["Jun", "Jul", "Aug", "Sep"];
const monthsLong = ["June", "July", "August", "September"];
const monthLengths = [30, 31, 31, 30];
const weekdays = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** June 1, 2026 is a Monday; the range ends on Sunday, September 27. */
const dayCount = 119;

function buildDays(): HorizonDay[] {
  const days: HorizonDay[] = [];
  let month = 0, date = 1;
  for (let i = 0; i < dayCount; i++) {
    days.push({ short: `${monthsShort[month]} ${date}`, long: `${weekdays[i % 7]}, ${monthsLong[month]} ${date}` });
    date++;
    if (date > monthLengths[month]) { month++; date = 1; }
  }
  return days;
}

export const horizonDays: HorizonDay[] = buildDays();

/** Day index of a date in the range, from a month (6 to 9) and a day of the month. */
function at(month: number, date: number): number {
  let index = 0;
  for (let m = 6; m < month; m++) index += monthLengths[m - 6];
  return index + date - 1;
}

/** Month starts as day indexes, for the x axis. */
export const horizonMonthTicks: { index: number; label: string }[] = monthsShort.map((label, i) => ({ index: at(6 + i, 1), label }));

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A smooth plateau: ramps in over `rise` days, holds, and ramps out over `fall` days. */
function plateau(i: number, start: number, end: number, rise = 4, fall = 4): number {
  if (i < start - rise || i > end + fall) return 0;
  if (i < start) return (i - (start - rise)) / rise;
  if (i > end) return 1 - (i - end) / fall;
  return 1;
}

/** A spike that jumps on `start` and decays with the given half life in days. */
function spike(i: number, start: number, halfLife: number, rise = 2): number {
  if (i < start - rise) return 0;
  if (i < start) return (i - (start - rise)) / rise;
  return Math.pow(0.5, (i - start) / halfLife);
}

type Shape = (i: number) => number;

interface MarketSpec { id: string; name: string; noise: number; weekend: number; shape: Shape }

const markets: MarketSpec[] = [
  { id: "amsterdam", name: "Amsterdam", noise: 2.6, weekend: -3, shape: i => 1 + i * 0.02 + 32 * spike(i, at(9, 8), 5) },
  { id: "berlin", name: "Berlin", noise: 2.4, weekend: -2, shape: i => -1 + i * 0.09 - 6 * plateau(i, at(8, 3), at(8, 14)) },
  { id: "copenhagen", name: "Copenhagen", noise: 2.8, weekend: -2, shape: i => 1 - 19 * plateau(i, at(6, 29), at(7, 24), 6, 6) },
  { id: "dublin", name: "Dublin", noise: 3.2, weekend: -1, shape: i => 0.5 + 2 * Math.sin(i / 9) },
  { id: "lisbon", name: "Lisbon", noise: 3, weekend: 1, shape: i => 1 - 24 * plateau(i, at(8, 1), at(8, 23), 6, 7) },
  { id: "london", name: "London", noise: 2.4, weekend: -3, shape: i => 1 + 30 * spike(i, at(7, 6), 9, 4) + 9 * plateau(i, at(9, 7), at(9, 30), 5, 0) },
  { id: "madrid", name: "Madrid", noise: 2.8, weekend: 0, shape: i => 0.5 - 29 * plateau(i, at(8, 1), at(8, 24), 6, 6) },
  { id: "milan", name: "Milan", noise: 2.6, weekend: -1, shape: i => 0 - 35 * plateau(i, at(8, 6), at(8, 23), 5, 5) - 8 * plateau(i, at(7, 25), at(8, 30), 6, 6) },
  { id: "paris", name: "Paris", noise: 2.5, weekend: -2, shape: i => 0.5 - 31 * plateau(i, at(7, 31), at(8, 21), 6, 7) + 6 * plateau(i, at(9, 1), at(9, 30), 4, 0) },
  { id: "prague", name: "Prague", noise: 2.4, weekend: -2, shape: i => -2 + i * 0.15 - 7 * plateau(i, at(7, 13), at(8, 9)) },
  { id: "stockholm", name: "Stockholm", noise: 2.5, weekend: -1, shape: i => 0.5 - 30 * plateau(i, at(6, 19), at(6, 20), 1, 2) - 13 * plateau(i, at(7, 1), at(7, 31), 6, 8) },
  { id: "vienna", name: "Vienna", noise: 2.4, weekend: -2, shape: i => 0.5 - 15 * plateau(i, at(8, 3), at(8, 21), 6, 6) },
  { id: "warsaw", name: "Warsaw", noise: 2.6, weekend: -2, shape: i => -1 + i * 0.12 - 44 * plateau(i, at(8, 18), at(8, 18), 1, 2) },
  { id: "zurich", name: "Zurich", noise: 2.2, weekend: -1, shape: i => 2 - i * 0.07 - 4 * plateau(i, at(7, 13), at(8, 7)) },
];

function buildSeries(): HorizonSeries[] {
  return markets.map((market, m) => {
    const next = random(9127 + m * 131);
    let drift = 0;
    const values: number[] = [];
    for (let i = 0; i < dayCount; i++) {
      // A little autocorrelated drift plus daily noise, so rows look measured rather than drawn.
      drift = drift * 0.7 + (next() - 0.5) * market.noise;
      const weekend = i % 7 >= 5 ? market.weekend : 0;
      const value = market.shape(i) + weekend + drift + (next() - 0.5) * market.noise;
      values.push(Math.round(Math.max(-36, Math.min(36, value)) * 10) / 10);
    }
    return { id: market.id, name: market.name, values };
  });
}

export const horizonSeries: HorizonSeries[] = buildSeries();

export const horizonTitle = "Sessions against baseline";
export const horizonDescription = "Daily sessions by market compared with each market's spring average, June to September 2026";
