// Streaks.
//
// Two of them, because they answer different questions:
//
//   play  — consecutive days you flew at all. The habit.
//   daily — consecutive days you completed the daily challenge. The ritual,
//           and the one worth sharing, because everyone flew the same course.
//
// THE GRACE DAY IS THE WHOLE DESIGN. A streak that dies the first time life
// happens does not motivate anyone; it punishes them and they stop opening the
// app. One missed day per calendar week is forgiven automatically and the
// player is told it was forgiven — which is a better moment than never having
// broken it. Two missed days is a real break, and the streak restarts at 1.
//
// Kept pure and dateless so the whole thing is exhaustively testable without
// clocks: every function takes the day keys it needs.

/** Days are 'YYYY-MM-DD', UTC — the same key Rng.today_key() produces. */
export function daysBetween(fromDay, toDay) {
  const [ay, am, ad] = fromDay.split('-').map(Number);
  const [by, bm, bd] = toDay.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
}

/**
 * ISO-8601 week key, 'YYYY-Www'. The grace allowance is one per ISO week, so
 * it refreshes on a Monday rather than on a rolling seven days — a fixed,
 * explicable boundary beats a clever one nobody can predict.
 */
export function isoWeek(dayKey) {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  // Thursday of this week determines the ISO year.
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const isoYear = date.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDayNum = firstThursday.getUTCDay() || 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() + 4 - firstDayNum);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Advance a streak to `today`.
 *
 * `state`  : { current, best, lastDay, graceWeek }
 * returns  : { current, best, lastDay, graceWeek, outcome, changed }
 *
 * outcome is one of:
 *   'same_day'  already counted today; nothing moved
 *   'extended'  yesterday → today
 *   'saved'     one day was missed and the week's grace covered it
 *   'broken'    too long a gap; the streak restarts at 1
 *   'started'   first ever day
 */
export function advanceStreak(state, today) {
  const current = Number(state?.current) || 0;
  const best = Number(state?.best) || 0;
  const lastDay = state?.lastDay || null;
  const graceWeek = state?.graceWeek || null;

  if (!lastDay || current <= 0) {
    return { current: 1, best: Math.max(best, 1), lastDay: today, graceWeek, outcome: 'started', changed: true };
  }
  if (lastDay === today) {
    return { current, best, lastDay, graceWeek, outcome: 'same_day', changed: false };
  }

  const gap = daysBetween(lastDay, today);

  // A clock skew or a hand-edited save could hand us a day in the past. Treat
  // it as already counted rather than letting it rewrite history.
  if (gap <= 0) {
    return { current, best, lastDay, graceWeek, outcome: 'same_day', changed: false };
  }

  if (gap === 1) {
    const next = current + 1;
    return { current: next, best: Math.max(best, next), lastDay: today, graceWeek, outcome: 'extended', changed: true };
  }

  const week = isoWeek(today);
  if (gap === 2 && graceWeek !== week) {
    const next = current + 1;
    return { current: next, best: Math.max(best, next), lastDay: today, graceWeek: week, outcome: 'saved', changed: true };
  }

  return { current: 1, best: Math.max(best, 1), lastDay: today, graceWeek, outcome: 'broken', changed: true };
}

/**
 * Whether a streak shown to the player is still alive as of `today`, without
 * advancing it. A streak last touched yesterday is alive; two days ago is
 * alive only while the week's grace is unspent.
 */
export function isAlive(state, today) {
  const lastDay = state?.lastDay;
  if (!lastDay || (Number(state?.current) || 0) <= 0) return false;
  const gap = daysBetween(lastDay, today);
  if (gap <= 1) return true;
  return gap === 2 && state?.graceWeek !== isoWeek(today);
}

/**
 * Milestones worth interrupting the player for. Deliberately sparse: a
 * celebration that fires every day is wallpaper, and wallpaper is ignored.
 */
export const MILESTONES = [3, 7, 14, 30, 60, 100, 365];

export function milestoneFor(current) {
  return MILESTONES.includes(current) ? current : null;
}
