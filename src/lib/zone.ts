/**
 * Day boundaries in a named time zone.
 *
 * Every window and bucket in the stats pages used to be computed in UTC, which
 * meant "Today" started at 01:00 for someone in Warsaw and at 19:00 the
 * previous evening for someone in New York. The figures were correct for a day
 * nobody was living in.
 *
 * Implemented with `Intl` rather than a date library: the zone database ships
 * with the runtime, and pulling in a dependency to answer "when did today
 * start in Asia/Dubai" is not a trade worth making.
 */

const DAY_MS = 86_400_000;

/** Falls back to UTC rather than throwing — an unknown zone must not 500 a dashboard. */
export function isValidZone(zone: string | null | undefined): zone is string {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const resolveZone = (zone: string | null | undefined): string =>
  isValidZone(zone) ? zone : 'UTC';

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

// Cached because these are rebuilt per row when bucketing a long range, and
// constructing a DateTimeFormat is one of the more expensive things in Intl.
function formatter(zone: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(zone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(zone, f);
  }
  return f;
}

function partsIn(instant: Date, zone: string): Parts {
  const p = Object.fromEntries(
    formatter(zone)
      .formatToParts(instant)
      .filter((x) => x.type !== 'literal')
      .map((x) => [x.type, x.value]),
  ) as Record<string, string>;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    // `hour12: false` yields 24 for midnight in some ICU versions.
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
  };
}

/** How far the zone is from UTC at a given instant, in milliseconds. */
function offsetMs(instant: Date, zone: string): number {
  const p = partsIn(instant, zone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Seconds resolution is enough; the remainder is the instant's own ms.
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * The instant at which a given local calendar date begins.
 *
 * Computed twice on purpose. The first pass uses the offset at `instant`, which
 * is wrong when the day being asked about sits on the other side of a DST
 * change; the second uses the offset at the candidate midnight and lands on
 * the right one. Two passes settle every real-world zone.
 */
export function startOfZonedDay(instant: Date, zone: string): Date {
  const p = partsIn(instant, zone);
  const localMidnight = Date.UTC(p.year, p.month - 1, p.day);
  let utc = localMidnight - offsetMs(instant, zone);
  utc = localMidnight - offsetMs(new Date(utc), zone);
  return new Date(utc);
}

/** The instant a local date STRING (YYYY-MM-DD) begins in the zone. */
export function startOfZonedDate(date: string, zone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const localMidnight = Date.UTC(y, m - 1, d);
  // Seeded from the naive UTC instant, then corrected the same way.
  let utc = localMidnight - offsetMs(new Date(localMidnight), zone);
  utc = localMidnight - offsetMs(new Date(utc), zone);
  return new Date(utc);
}

/** The last instant of a local date — inclusive end of a custom range. */
export const endOfZonedDate = (date: string, zone: string): Date =>
  new Date(addZonedDays(startOfZonedDate(date, zone), 1, zone).getTime() - 1);

/**
 * Move by whole local days.
 *
 * Not `+ n * 86400000`: across a DST change a local day is 23 or 25 hours, and
 * adding a fixed span drifts the boundary by an hour for the rest of the range.
 */
export function addZonedDays(instant: Date, days: number, zone: string): Date {
  const p = partsIn(instant, zone);
  const localMidnight = Date.UTC(p.year, p.month - 1, p.day + days);
  let utc = localMidnight - offsetMs(instant, zone);
  utc = localMidnight - offsetMs(new Date(utc), zone);
  return new Date(utc);
}

/** Whole local hours, used by the hourly buckets on short ranges. */
export function addHours(instant: Date, hours: number): Date {
  return new Date(instant.getTime() + hours * 3_600_000);
}

export function startOfZonedHour(instant: Date, zone: string): Date {
  const p = partsIn(instant, zone);
  const local = Date.UTC(p.year, p.month - 1, p.day, p.hour);
  let utc = local - offsetMs(instant, zone);
  utc = local - offsetMs(new Date(utc), zone);
  return new Date(utc);
}

/** YYYY-MM-DD as the zone sees it — the key every daily bucket is grouped by. */
export function zonedDayKey(instant: Date, zone: string): string {
  const p = partsIn(instant, zone);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** YYYY-MM-DDTHH, for hourly buckets. */
export function zonedHourKey(instant: Date, zone: string): string {
  const p = partsIn(instant, zone);
  return `${zonedDayKey(instant, zone)}T${String(p.hour).padStart(2, '0')}`;
}

/** Inclusive count of local days between two instants. */
export function zonedDaysBetween(from: Date, to: Date, zone: string): number {
  const a = startOfZonedDay(from, zone).getTime();
  const b = startOfZonedDay(to, zone).getTime();
  return Math.max(0, Math.round((b - a) / DAY_MS)) + 1;
}
