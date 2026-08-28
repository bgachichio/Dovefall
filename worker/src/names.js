// Name suggestions, drawn from the game's own world.
//
// Names are not unique — the tag disambiguates — but a suggestion the player
// picks should feel theirs, so each one offered is confirmed unused at the
// moment of suggestion. The vocabulary is the game's: its chapters (storm,
// deep, fish, Nineveh), its skins, its weather.

const FIRST = [
  'Storm', 'Deep', 'Sky', 'Dawn', 'Dusk', 'Night', 'Salt', 'Wind',
  'Ember', 'Golden', 'Silver', 'Swift', 'Quiet', 'Brave', 'Bright', 'Wild',
  'Coral', 'Cedar', 'Reed', 'Wave', 'Cloud', 'Rain', 'Thorn', 'Drift',
];

const SECOND = [
  'Dove', 'Wing', 'Feather', 'Flier', 'Glider', 'Pilot', 'Sparrow', 'Swallow',
  'Petrel', 'Skylark', 'Fledgling', 'Wanderer', 'Runner', 'Diver', 'Scout', 'Herald',
  'Voyager', 'Pathfinder', 'Keeper', 'Watcher', 'Singer', 'Dreamer', 'Racer', 'Rider',
];

export function randomName(rand = Math.random) {
  const a = FIRST[Math.floor(rand() * FIRST.length)];
  const b = SECOND[Math.floor(rand() * SECOND.length)];
  return `${a} ${b}`;
}

async function isTaken(db, name) {
  const row = await db.prepare('SELECT 1 AS x FROM players WHERE name = ?1 LIMIT 1').bind(name).first();
  return row !== null;
}

/**
 * Three distinct names, each confirmed unused right now. If the plain
 * combinations are exhausted locally (they collide long before 576 players —
 * birthday arithmetic), a two-digit suffix keeps suggestions flowing forever.
 *
 * "Confirmed available" is a courtesy, not a lock: someone else can take the
 * name a second later, and that is fine — names are not unique here, and the
 * tag keeps everyone distinct. This just avoids OFFERING a duplicate.
 */
export async function suggestNames(db, { count = 3, rand = Math.random } = {}) {
  const out = new Set();
  let attempts = 0;

  while (out.size < count && attempts < 24) {
    attempts += 1;
    const candidate = randomName(rand);
    if (out.has(candidate)) continue;
    if (!(await isTaken(db, candidate))) out.add(candidate);
  }

  while (out.size < count) {
    const candidate = `${randomName(rand)} ${10 + Math.floor(rand() * 90)}`;
    if (out.has(candidate)) continue;
    if (!(await isTaken(db, candidate))) out.add(candidate);
  }

  return [...out];
}

export const WORD_COUNTS = { first: FIRST.length, second: SECOND.length };
