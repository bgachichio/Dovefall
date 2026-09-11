// The tuning. Originally generated from autoload/Config.gd and autoload/Art.gd
// of the Dovefall Godot project by `npm run port -- <godot-project>`.
//
// That project is no longer part of this repository — the port script still
// works, but it takes a path that nothing here provides, so THIS FILE is now
// the source of these numbers rather than a copy of them. Edit it directly and
// deliberately; the old "do not edit by hand" banner was true when there was
// something to regenerate from, and became a lie the day the engine was
// dropped.
//
// Two things keep the two runtimes honest about it:
//
//   worker/src/config.js  mirrors MODES and BANDS, and must change in the same
//                         commit, or the server will reject runs the client
//                         considers ordinary.
//   the determinism check  in game/test and worker/test recomputes a checksum
//                         from grav, flap and the RNG. Change one of them
//                         without the other and the tests fail loudly.
//
// The server's copy of the RNG (worker/src/rng.js) and its plausibility bounds
// (worker/src/bounds.js) are derived from these same values, which is what
// makes a score submitted by this client checkable by that server.

export const VERSION = "0.1.0" as const;

export const FIXED = 1.0 / 120.0;

export const TERMINAL_MULT = 0.55 as const;

export const RESTART_MS = 320 as const;

export const DDA_WIDEN = 0.04 as const;

/**
 * The glide retune.
 *
 * Gravity is 0.85 of what it was and the flap impulse is sqrt(0.85) of what it
 * was, which is not a coincidence: the height a single tap buys you is
 * flap^2 / 2*grav, so scaling grav by k and flap by sqrt(k) leaves that height
 * identical to four significant figures while the arc takes 8.4% longer to
 * travel. That is the whole difference between a jump and a glide — the dove
 * goes exactly as high, just less abruptly — and terminal velocity, which is
 * grav * TERMINAL_MULT, drops 15% with it, so the fall is gentler too.
 *
 * spd and gsp both rise 4%. Both, together, on purpose: gates arrive every
 * gsp/spd seconds, so scaling the pair by the same factor leaves the cadence —
 * and therefore the score you can reach in a given time — exactly as it was.
 * The world is 4% brisker and the leaderboard still means the same thing.
 *
 * What does change: a full flap arc now covers 12.8% more ground while gates
 * are only 4% further apart, so on normal it is about 3.0 taps between gates
 * where it was 3.3. Fewer, larger corrections. That is the retune, stated
 * honestly — it is not a difficulty-neutral change, because softening gravity
 * cannot be one.
 *
 * gap is measured in dove-heights, and the dove got shorter in the same commit
 * (DOVE_H, below), so gap moved to compensate: the hole you fly through is the
 * same hole in pixels, to the pixel. hit (the collision box, as a fraction of
 * the sprite) and coy (coyote time) are untouched.
 *
 * `kids` is not on the ladder. See MODE_ORDER and RANKED_MODES below.
 */
export const MODES = {
	"kids":   {"grav": 1300.0, "flap": 392.0, "gap": 5.300, "spd": 168.0, "gsp": 290.0, "hit": 0.70, "coy": 0.260},
	"easy":   {"grav": 1785.0, "flap": 433.3, "gap": 5.920, "spd": 208.0, "gsp": 270.4, "hit": 0.82, "coy": 0.180},
	"normal": {"grav": 2231.3, "flap": 470.2, "gap": 4.773, "spd": 270.4, "gsp": 343.2, "hit": 0.91, "coy": 0.170},
	"hard":   {"grav": 2465.0, "flap": 488.6, "gap": 4.263, "spd": 312.0, "gsp": 390.0, "hit": 0.95, "coy": 0.110},
	"pro":    {"grav": 2720.0, "flap": 502.5, "gap": 3.750, "spd": 343.2, "gsp": 416.0, "hit": 1.00, "coy": 0.060},
} as const;

/** Every mode, in the order the Settings screen lists them. */
export const MODE_ORDER = ["kids", "easy", "normal", "hard", "pro"] as const;

/**
 * The modes that carry a leaderboard.
 *
 * Kids mode is deliberately outside it. A six-year-old should not be able to
 * put a 400 next to an adult's 55 and be told, correctly, that it does not
 * count — so it is never offered the comparison in the first place.
 */
export const RANKED_MODES = ["easy", "normal", "hard", "pro"] as const;

export const BANDS = [
	{"from": 0,  "gap_x": 1.167, "spd_x": 1.00, "name": "I"},
	{"from": 5,  "gap_x": 1.000, "spd_x": 1.00, "name": "II"},
	{"from": 15, "gap_x": 0.889, "spd_x": 1.10, "name": "III"},
	{"from": 30, "gap_x": 0.833, "spd_x": 1.20, "name": "IV"},
	{"from": 50, "gap_x": 0.806, "spd_x": 1.25, "name": "V"},
] as const;

export const RAMP = [
	{"from": 0,  "amp": 0.30, "delta": 0.16, "ground": false, "air": false, "drift": false, "dens": 0.00},
	{"from": 5,  "amp": 0.30, "delta": 0.16, "ground": false, "air": false, "drift": false, "dens": 0.00},
	{"from": 7,  "amp": 0.55, "delta": 0.30, "ground": false, "air": false, "drift": false, "dens": 0.00},
	{"from": 12, "amp": 0.55, "delta": 0.30, "ground": true,  "air": false, "drift": false, "dens": 0.30},
	{"from": 15, "amp": 0.55, "delta": 0.30, "ground": true,  "air": false, "drift": false, "dens": 0.30},
	{"from": 20, "amp": 0.75, "delta": 0.42, "ground": true,  "air": true,  "drift": false, "dens": 0.30},
	{"from": 25, "amp": 1.00, "delta": 1.00, "ground": true,  "air": true,  "drift": false, "dens": 0.30},
	{"from": 30, "amp": 1.00, "delta": 1.00, "ground": true,  "air": true,  "drift": false, "dens": 0.34},
	{"from": 35, "amp": 1.00, "delta": 1.00, "ground": true,  "air": true,  "drift": true,  "dens": 0.34},
	{"from": 42, "amp": 1.00, "delta": 1.00, "ground": true,  "air": true,  "drift": true,  "dens": 0.52},
	{"from": 50, "amp": 1.00, "delta": 1.00, "ground": true,  "air": true,  "drift": true,  "dens": 0.52},
] as const;

/**
 * The scenery. Ten scenes, cycling forever.
 *
 * This used to be four fixed chapters, each named for a place in the book of
 * Jonah and shown to the player as a citation — "The Storm · Jonah 1:4" — in
 * Credits. The verse references never earned their place there: a player
 * asked whether they added anything, and once asked, the honest answer was
 * no. What DOES earn its place is what those four chapters actually
 * produced on screen — the sky, the ground and the obstacles changing
 * colour as a run goes on — and that is the part this keeps and grows.
 *
 * The first four entries are unchanged from the original four chapters, so
 * an existing run's early pacing (chapterIndex(0|5|15|30), tested in
 * engine.test.mjs) is untouched. Six more scenes follow, then the whole
 * roster of ten repeats forever — see chapterIndex() in sim.ts. A long run
 * never runs out of new sky to fly through; it also never runs out of OLD
 * sky, because scene 11 is scene 1 again. `kind` picks which hazard/gate/
 * landmark shapes a scene borrows (see GROUND_HZ, AIR_HZ, GATE_PATTERN,
 * LANDMARKS below) — recoloured per scene, the same way SKINS recolours one
 * dove shape six ways, rather than every scene needing its own hand-drawn
 * obstacle set.
 */
export const CHAPTERS = [
	{"from": 0,   "name": "The Storm", "kind": "mast",
	 "sky": "#4E6A7A", "far": "#3A5364", "mid": "#31485A", "gnd": "#263644",
	 "ob": "#93A7B3", "obd": "#5D6F7C", "obt": "#B4C4CD", "hzg": "#7E93A0", "hza": "#EDF3F7"},
	{"from": 5,   "name": "The Deep",  "kind": "kelp",
	 "sky": "#0F4152", "far": "#0B3243", "mid": "#092A38", "gnd": "#061F2A",
	 "ob": "#2A8A76", "obd": "#155A4C", "obt": "#3FB39A", "hzg": "#C9647A", "hza": "#B8E8F0"},
	{"from": 15,  "name": "The Fish",  "kind": "rib",
	 "sky": "#3E1E19", "far": "#2E1411", "mid": "#26100E", "gnd": "#1A0B0A",
	 "ob": "#9A5140", "obd": "#633026", "obt": "#C0705B", "hzg": "#E8DCC8", "hza": "#D8C8B0"},
	{"from": 30,  "name": "Nineveh",   "kind": "tower",
	 "sky": "#F2A65A", "far": "#E88C3F", "mid": "#D97B31", "gnd": "#A85E1C",
	 "ob": "#D9A441", "obd": "#9C7020", "obt": "#F0CB72", "hzg": "#2F6B33", "hza": "#E8503C"},
	{"from": 45,  "name": "Dusk",      "kind": "mast",
	 "sky": "#6B5A8C", "far": "#4F4368", "mid": "#3E344F", "gnd": "#2A2337",
	 "ob": "#C9A6D9", "obd": "#8A6B9E", "obt": "#E6CCF0", "hzg": "#A984BE", "hza": "#FFE9D6"},
	{"from": 65,  "name": "Frost",     "kind": "kelp",
	 "sky": "#C9E4EE", "far": "#A3CBDC", "mid": "#7FADC4", "gnd": "#52829E",
	 "ob": "#2F5B77", "obd": "#1D3C50", "obt": "#6FA8C4", "hzg": "#8AC4DE", "hza": "#FFFFFF"},
	{"from": 85,  "name": "Wildfire",  "kind": "rib",
	 "sky": "#7A2E1E", "far": "#5C2116", "mid": "#491A11", "gnd": "#33110A",
	 "ob": "#E0602E", "obd": "#9C3D18", "obt": "#F5924E", "hzg": "#FFD27A", "hza": "#FFF1C2"},
	{"from": 105, "name": "Aurora",    "kind": "tower",
	 "sky": "#1A2E3D", "far": "#142330", "mid": "#101C26", "gnd": "#0A1218",
	 "ob": "#3FBF8F", "obd": "#227A57", "obt": "#7DE8BE", "hzg": "#6B4FA8", "hza": "#C9A0FF"},
	{"from": 125, "name": "Monsoon",   "kind": "mast",
	 "sky": "#3A4650", "far": "#2C363E", "mid": "#232B32", "gnd": "#171D22",
	 "ob": "#7C93A0", "obd": "#4E606C", "obt": "#A9BDC7", "hzg": "#5E7482", "hza": "#E8F0F4"},
	{"from": 145, "name": "Eclipse",   "kind": "kelp",
	 "sky": "#0E0E14", "far": "#0A0A10", "mid": "#07070B", "gnd": "#030305",
	 "ob": "#4A4A5E", "obd": "#2C2C3A", "obt": "#7A7A96", "hzg": "#57576E", "hza": "#F5D76E"},
] as const;

/** After the last scene, advance one scene every this many points, looping
 *  the whole ten-scene roster forever. */
export const CHAPTER_CYCLE_STEP = 20 as const;

export const DAY_LENGTH_PX = 18000.0 as const;

export const CROSSFADE_S = 3.0 as const;

export const LIGHT_MIN = 0.52 as const;

export const LIGHT_MAX = 1.00 as const;

export const DUSK_WARM = 0.26 as const;

export const ATMOS_BACKDROP = 1.0 as const;

export const ATMOS_OBSTACLE = 0.5 as const;

export const PARTICLES = 38 as const;

export const LANDMARK_GAP = [1900.0, 3300.0] as const;

export const FLASH_ALPHA_MAX = 0.22 as const;

export const DOVE_W = 16 as const;

/**
 * Eight rows, not ten.
 *
 * The dove read as a brick on a phone. It is now 20% shorter with a wing that
 * carries about 11% more of it — and because the gap a player flies through is
 * measured in dove-heights (curGap in sim.ts), shrinking this number alone
 * would have shrunk the hole with it and quietly made the game harder.
 *
 * So every mode's `gap` was re-derived to hold the one thing that decides how
 * hard a gate is: the pixels of clearance between the top of the hitbox and the
 * bottom of it. gap_new = 1.25 * gap_old - 0.25 * hit, which leaves
 * (gap in px - hitbox height in px) identical to the pixel. game/test asserts
 * exactly that, mode by mode.
 */
export const DOVE_H = 8 as const;

export const DOVE_DIVISOR = 51.0 as const;

export const SKINS = [
	{"id": "dove",  "name": "Dove",     "cost": 0,   "W": "#FFFFFF", "G": "#C2D2E0", "D": "#2B3A4A", "E": "#1A2430", "O": "#F2A65A"},
	{"id": "raven", "name": "Raven",    "cost": 60,  "W": "#3E4757", "G": "#282F3A", "D": "#11151B", "E": "#EDEDED", "O": "#8A8F98"},
	{"id": "ember", "name": "Ember",    "cost": 140, "W": "#F5C26B", "G": "#E08A3C", "D": "#6B3210", "E": "#2A1206", "O": "#D94F2B"},
	{"id": "tarsh", "name": "Tarshish", "cost": 240, "W": "#8FE3D0", "G": "#3FB39A", "D": "#0E3B33", "E": "#062420", "O": "#F2A65A"},
	{"id": "gold",  "name": "Nineveh",  "cost": 380, "W": "#FFE9B0", "G": "#F0C07A", "D": "#8C5A18", "E": "#3A2408", "O": "#D9A441"},
	{"id": "obsid", "name": "Obsidian", "cost": 600, "W": "#5A6270", "G": "#3A414C", "D": "#0A0C10", "E": "#F0C07A", "O": "#B0642A"},
] as const;

export const SW_MIN_SCORE = 8 as const;

export const SW_MIN_SESSION_DEATHS = 2 as const;

export const SW_CLEAR_AHEAD = 2.6 as const;

export const SW_INVULN_S = 1.5 as const;

export const SW_COUNTDOWN_S = 2.2 as const;

export const NAVY = "#1F3864" as const;

export const COPPER = "#B0642A" as const;

export const GOLD = "#F0C07A" as const;

export const INK = "#0D1420" as const;

export const PAPER = "#EEF4FF" as const;

/**
 * Every word the game says.
 *
 * The rule for this table: a game speaks in the imperative and the concrete.
 * "Get respawns" is a shop; "Keep flying" is a game. "Reduced flashing" is a
 * settings menu; "Gentle flashes" is a kindness. Nothing here explains itself
 * unless a player would otherwise be stuck, and nothing apologises.
 *
 * The core loop still contains no words at all, which is why the whole
 * translatable surface fits on a screen.
 */
export const STRINGS = {
	"en": {
		"play": "Fly", "daily": "Today's Sky", "wardrobe": "Wardrobe",
		"settings": "Settings", "leaderboard": "Leaderboard", "back": "Back",
		"audio": "Sound", "sfx": "Sound", "haptics": "Buzz",
		"visual": "Look", "atmosphere": "Weather", "flashing": "Gentle flashes",
		"colourblind": "Colour-blind palette", "lefthand": "Left-handed",
		"game": "Flight", "difficulty": "How hard", "account": "Account",
		"playgames": "Google Play Games", "restore": "Restore purchases",
		"language": "Language", "legal": "Legal", "privacy": "Privacy policy",
		"terms": "Terms", "deletedata": "Delete my data", "licences": "Open-source licences",
		"about": "About", "version": "Version", "seed": "Last run seed",
		"off": "Off", "full": "Full", "on": "On", "reduced": "Some",
		"kids": "Kids", "easy": "Easy", "normal": "Normal", "hard": "Hard", "pro": "Pro",
		"owned": "Worn", "wear": "Wear", "locked": "Locked",
		"streak": "Streak", "best": "Best", "feathers": "Feathers",
		"tagline": "One touch. Storm, deep and sky.",
		"credits": "Credits", "madeby": "Made by", "builtwith": "Built with",
		"scenery": "Scenery", "website": "Elsewhere",
		"playername": "Your name", "savename": "That's me",
		"recovery": "Recovery", "getcode": "Show me the code",
		"entercode": "Recovery code", "restoreacct": "Restore it",
		"respawns": "Respawns", "getrespawns": "More hearts",
		"copycode": "Copy the code", "paynow": "Pay with Paystack", "ihavepaid": "I've paid",
		"share": "Share", "sharebest": "Tell someone",
		"suggest": "Pick one", "keepname": "Keep my name",
		"choosename": "What shall we call you?", "wellflown": "Well flown",
		"days": "days", "streaksaved": "Streak held", "streakboard": "Longest streaks",
		"threemore": "Three more", "orname": "Or make one up",
		"guest": "Flying as a guest", "resume": "Back to it", "quit": "Leave the sky",
		"flyagain": "Fly again", "keepflying": "Keep flying", "newbest": "A new best",
		"clipped": "Clipped", "down": "Down", "unranked": "off the board",
		"tapflap": "TAP TO FLAP", "clickflap": "CLICK TO FLAP", "orspace": "or press space",
		"hazard": "SOMETHING AHEAD · CLIMB OR DIVE",
		"alltime": "All time", "you": "You", "saved": "Saved",
		"nonet": "No connection. Everything you have flown is safe on this phone.",
		"offline": "Offline — make one up instead.",
	},
	"sw": {
		"play": "Ruka", "daily": "Anga la Leo", "wardrobe": "Nguo",
		"settings": "Mipangilio", "leaderboard": "Ubao wa Alama", "back": "Rudi",
		"audio": "Sauti", "sfx": "Sauti", "haptics": "Mtetemo",
		"visual": "Mwonekano", "atmosphere": "Hali ya anga", "flashing": "Mwangaza mpole",
		"colourblind": "Rangi kwa upofu wa rangi", "lefthand": "Mkono wa kushoto",
		"game": "Safari", "difficulty": "Ugumu", "account": "Akaunti",
		"playgames": "Google Play Games", "restore": "Rejesha manunuzi",
		"language": "Lugha", "legal": "Kisheria", "privacy": "Sera ya faragha",
		"terms": "Masharti", "deletedata": "Futa data yangu", "licences": "Leseni huria",
		"about": "Kuhusu", "version": "Toleo", "seed": "Mbegu ya mchezo",
		"off": "Zima", "full": "Kamili", "on": "Washa", "reduced": "Kiasi",
		"kids": "Watoto", "easy": "Rahisi", "normal": "Kawaida", "hard": "Ngumu", "pro": "Bingwa",
		"owned": "Imevaliwa", "wear": "Vaa", "locked": "Imefungwa",
		"streak": "Mfululizo", "best": "Bora", "feathers": "Manyoya",
		"tagline": "Mguso mmoja. Dhoruba, kina na anga.",
		"credits": "Waliohusika", "madeby": "Imetengenezwa na",
		"builtwith": "Imejengwa kwa", "scenery": "Mandhari", "website": "Kwingineko",
		"playername": "Jina lako", "savename": "Ndiye mimi",
		"recovery": "Kurejesha", "getcode": "Nionyeshe msimbo",
		"entercode": "Msimbo wa kurejesha", "restoreacct": "Nirudishie",
		"respawns": "Nafasi zaidi", "getrespawns": "Mioyo zaidi",
		"copycode": "Nakili msimbo", "paynow": "Lipa kwa Paystack", "ihavepaid": "Nimelipa",
		"share": "Shiriki", "sharebest": "Mwambie mtu",
		"suggest": "Chagua moja", "keepname": "Baki na jina langu",
		"choosename": "Tukuite nani?", "wellflown": "Safari njema",
		"days": "siku", "streaksaved": "Mfululizo umeshikilia", "streakboard": "Mifululizo mirefu",
		"threemore": "Mengine matatu", "orname": "Au buni lako",
		"guest": "Unaruka kama mgeni", "resume": "Rudi kwenye mchezo", "quit": "Ondoka angani",
		"flyagain": "Ruka tena", "keepflying": "Endelea kuruka", "newbest": "Bora kuliko zote",
		"clipped": "Umegusa", "down": "Umeanguka", "unranked": "nje ya ubao",
		"tapflap": "GUSA ILI KURUKA", "clickflap": "BOFYA ILI KURUKA", "orspace": "au bonyeza space",
		"hazard": "KUNA KITU MBELE · PANDA AU SHUKA",
		"alltime": "Wakati wote", "you": "Wewe", "saved": "Imehifadhiwa",
		"nonet": "Hakuna mtandao. Kila ulichoruka kipo salama kwenye simu hii.",
		"offline": "Nje ya mtandao — buni jina lako.",
	},
} as const;

export const DOVE_FRAMES = [
	// 0: wings up, straight after a tap
	[
	"....DDDDDD......",
	"..DDGGGGGGDD....",
	".DWGGGGGGWWWWD..",
	"DWGGGGGGGWWEEWD.",
	"DWWGGGGGWWWWWWDD",
	".DWWWWWWWWWWWWDO",
	"..DWWWWWWWWWWWDO",
	"...DDWWWWWWWDD..",
	],
	// 1: wings level — the glide
	[
	"....DDDDDD......",
	"..DDWWWWWWDD....",
	".DWWWWWWWWWWWD..",
	"DWWWWWWWWWWEEWD.",
	"DWGGGGGGGWWWWWDD",
	".DWGGGGGGGWWWWDO",
	"..DWWGGGGWWWWWDO",
	"...DDWWWWWWWDD..",
	],
	// 2: wings down — the fall
	[
	"......DDDD......",
	"...DDWWWWWWD....",
	"..DWWWWWWWWWD...",
	".DWWWWWWWWEEWD..",
	"DWWWWWWWWWWWWWDD",
	".DWGGGGGGGWWWWDO",
	"..DWGGGGGGGWWWDO",
	"...DDWGGGGWWDD..",
	],
	// 3: wings mid — the recovery
	[
	".....DDDDD......",
	"..DDWWWWWWDD....",
	"..DWWGGGGWWWWWD.",
	"DWGGGGGGGWWEEWD.",
	"DWGGGGGGGWWWWWDD",
	".DWWWGGGWWWWWWDO",
	"..DWWWWWWWWWWWDO",
	"...DDWWWWWWWDD..",
	],
] as const;

export const FLAP_SEQUENCE = [0, 0, 3, 3, 1] as const;

export const FLAP_FRAME_S = 0.055 as const;

export const GROUND_HZ = {
	"mast": [   
	"................",
	".......LL.......",
	"......LWWL......",
	".....LWWWWL.....",
	"....LWWWWWWL....",
	"...WWWWWWWWWW...",
	"..WWWKKWWKKWWW..",
	".WWWKKKWWKKKWWW.",
	"WWWKKKKWWKKKKWWW",
	"WWWWWWWWWWWWWWWW",
	],
	"kelp": [   
	".....W..........",
	".....W....W.....",
	"..W..WK...W.....",
	"..W..WK..WK.W...",
	"..WK.WK..WK.W...",
	"W.WK.WKW.WK.WK..",
	"W.WK.WKW.WK.WK.W",
	"WKWKWWKWWWKWWKWW",
	"WWWWWWWWWWWWWWWW",
	"WWWWWWWWWWWWWWWW",
	],
	"rib": [    
	".......WW.......",
	"......WWWW......",
	"......WWWW......",
	".....WWWWWW.....",
	"....WWWKKWWW....",
	"...WWWWKKWWWW...",
	"..WWWWWKKWWWWW..",
	".WWWWWWKKWWWWWW.",
	"WWWWWWWKKWWWWWWW",
	"WWWWWWWWWWWWWWWW",
	],
	"tower": [  
	"......WWWW......",
	"....WWWWWWWW....",
	"...WWWWWWWWWW...",
	"..WWWWKKWWWWWW..",
	".WWWWKKKKWWWWWW.",
	"WWWWWKKKKKWWWWWW",
	"..WWWWKKWWWWWW..",
	"......KKKK......",
	"......KKKK......",
	"......KKKK......",
	],
} as const;

export const AIR_HZ = {
	"mast": [   
	"WW............WW",
	".WWW........WWW.",
	"..WWWW....WWWW..",
	"....WWWWWWWW....",
	"......WKKW......",
	".....WWKKWW....O",
	"......WWWW.....O",
	"................",
	],
	"kelp": [   
	"....WWWWWWWW....",
	"..WWWWWWWWWWWW..",
	".WWWWWWWWWWWWWW.",
	".WWWKWWWWWWKWWW.",
	"..WWWWWWWWWWWW..",
	"...W...W...W....",
	"...W...W...W....",
	"..W....W....W...",
	],
	"rib": [    
	"WWW..........WWW",
	"WWWW........WWWW",
	".WWWWWWWWWWWWWW.",
	"..WWWWWWWWWWWW..",
	"..WWWWWWWWWWWW..",
	".WWWWWWWWWWWWWW.",
	"WWWW........WWWW",
	"WWW..........WWW",
	],
	"tower": [  
	".......WW.......",
	".....WWWWWW.....",
	"...WWWWKKWWWW...",
	".WWWWWWKKWWWWWW.",
	"...WWWWKKWWWW...",
	".....WWWWWW.....",
	".......WW.......",
	"......K..K......",
	],
} as const;

export const GATE_PATTERN = {
	"mast":  ["KKKKKKKK", "K......K", "K.LLLL.K", "K......K", "KKKKKKKK", "........"],
	"kelp":  ["..LL....", ".LLLL...", "..LL..KK", "......KK", "KK..LL..", "KK.LLLL."],
	"rib":   ["KKKKKKKK", "KKKKKKKK", "........", "..LLLL..", "........", "........"],
	"tower": ["..LL.LL.", "..LL.LL.", "........", "KKKKKKKK", "..LL.LL.", "..LL.LL."],
} as const;

export const LANDMARKS = {
	"mast": [   
	"..........W.............",
	"..........W.............",
	".........WWW......W.....",
	"........WWWWW.....W.....",
	".......WWWWWWW...WWW....",
	"......WWWWWWWWW.WWWWW...",
	".....WWWWWWWWWWWWWWWWW..",
	"..........W.............",
	"..........W.............",
	"..........W.......W.....",
	"WWWWWWWWWWWWWWWWWWWWWW..",
	".WWWWWWWWWWWWWWWWWWWW...",
	"..WWWWWWWWWWWWWWWWWW....",
	"....WWWWWWWWWWWWWW......",
	],
	"kelp": [   
	"........................",
	"..................WW....",
	".................WWW....",
	"....WWWWWWWWWWWWWWWW....",
	"..WWWWWWWWWWWWWWWWWWWW..",
	".WWWWWWWWWWWWWWWWWWWWWW.",
	"WWWWWWWWWWWWWWWWWWWWWWWW",
	"WWWWWWWWWWWWWWWWWWWWWWW.",
	".WWWWWWWWWWWWWWWWWWWW...",
	"..WWWWWWWWWWWWWWWW......",
	"W..WWWWWWWWWWWW.........",
	"WW..WWWWWWWW............",
	"WWW.....................",
	"WW......................",
	],
	"rib": [    
	"....WWWWWWWWWWWWWW......",
	"...W..............W.....",
	"..W................W....",
	".W..................W...",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	"W....................W..",
	],
	"tower": [  
	"........................",
	"..........WWWW..........",
	"..........WWWW..........",
	".........WWWWWW.........",
	"........WWWWWWWW........",
	"........WWWWWWWW........",
	"......WWWWWWWWWWWW......",
	"......WWWWWWWWWWWW......",
	"....WWWWWWWWWWWWWWWW....",
	"....WWWWWWWWWWWWWWWW....",
	"..WWWWWWWWWWWWWWWWWWWW..",
	"..WWWWWWWWWWWWWWWWWWWW..",
	"WWWWWWWWWWWWWWWWWWWWWWWW",
	"WWWWWWWWWWWWWWWWWWWWWWWW",
	],
} as const;
