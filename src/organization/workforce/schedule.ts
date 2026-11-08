/** Office calendar for Tambala staff. Malawi has no daylight saving, so this is a fixed UTC+2 clock. */
export const OFFICE_TZ = 'Africa/Blantyre';
export const WORK_START = '08:00';
export const WORK_END = '17:00';

export type Cadence = { kind: 'weekdays' } | { kind: 'weekly'; day: number /* 1=Mon … 7=Sun */ };

export interface LocalTime {
  date: string;      // YYYY-MM-DD in office time
  weekday: number;   // 1=Mon … 7=Sun
  minutes: number;   // minutes since local midnight
  isoWeek: string;   // YYYY-Www
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function isoWeekOf(y: number, m: number, d: number): string {
  const dt = new Date(Date.UTC(y, m - 1, d));
  const day = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((dt.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return `${dt.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function localTime(now: Date, tz: string = OFFICE_TZ): LocalTime {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const y = Number(get('year')); const m = Number(get('month')); const d = Number(get('day'));
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    weekday: WEEKDAY[get('weekday')] ?? 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
    isoWeek: isoWeekOf(y, m, d),
  };
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Is the duty scheduled for this calendar day at all? */
export function runsToday(cadence: Cadence, lt: LocalTime): boolean {
  return cadence.kind === 'weekdays' ? lt.weekday <= 5 : lt.weekday === cadence.day;
}

/** One run per period: per day for weekday duties, per ISO week for weekly duties. */
export function periodKey(cadence: Cadence, lt: LocalTime): string {
  return cadence.kind === 'weekdays' ? lt.date : lt.isoWeek;
}

export function timeReached(time: string, lt: LocalTime): boolean {
  return lt.minutes >= toMinutes(time);
}

export function isWorkingHours(lt: LocalTime): boolean {
  return lt.weekday <= 5 && lt.minutes >= toMinutes(WORK_START) && lt.minutes < toMinutes(WORK_END);
}

export function cadenceLabel(cadence: Cadence, time: string): string {
  const days = ['', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays', 'Sundays'];
  return cadence.kind === 'weekdays' ? `Every weekday at ${time}` : `${days[cadence.day]} at ${time}`;
}
