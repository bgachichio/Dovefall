// GENERATED — do not edit by hand.
//
//   npm run port -- <godot-project>
//
// Transformed from autoload/Config.gd and autoload/Art.gd of the Dovefall
// Godot project. These are the tuned numbers from the Android build: change
// one here and the web game stops being the same game.
//
// The server's copy of the RNG (worker/src/rng.js) and its plausibility bounds
// (worker/src/bounds.js) are derived from these same values, which is what
// makes a score submitted by this client checkable by that server.

export const VERSION = "0.1.0" as const;

export const FIXED = 1.0 / 120.0;

export const TERMINAL_MULT = 0.55 as const;

export const RESTART_MS = 320 as const;

export const DDA_WIDEN = 0.04 as const;

export const MODES = {
	"easy":   {"grav": 2100.0, "flap": 470.0, "gap": 4.9, "spd": 200.0, "gsp": 260.0, "hit": 0.82, "coy": 0.180},
	"normal": {"grav": 2625.0, "flap": 510.0, "gap": 4.0, "spd": 260.0, "gsp": 330.0, "hit": 0.91, "coy": 0.170},
	"hard":   {"grav": 2900.0, "flap": 530.0, "gap": 3.6, "spd": 300.0, "gsp": 375.0, "hit": 0.95, "coy": 0.110},
	"pro":    {"grav": 3200.0, "flap": 545.0, "gap": 3.2, "spd": 330.0, "gsp": 400.0, "hit": 1.00, "coy": 0.060},
} as const;

export const MODE_ORDER = ["easy", "normal", "hard", "pro"] as const;

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

export const CHAPTERS = [
	{"from": 0,  "name": "The Storm",  "ref": "Jonah 1:4",  "kind": "mast",
	 "sky": "#4E6A7A", "far": "#3A5364", "mid": "#31485A", "gnd": "#263644",
	 "ob": "#93A7B3", "obd": "#5D6F7C", "obt": "#B4C4CD", "hzg": "#7E93A0", "hza": "#EDF3F7"},
	{"from": 5,  "name": "The Deep",   "ref": "Jonah 2:3",  "kind": "kelp",
	 "sky": "#0F4152", "far": "#0B3243", "mid": "#092A38", "gnd": "#061F2A",
	 "ob": "#2A8A76", "obd": "#155A4C", "obt": "#3FB39A", "hzg": "#C9647A", "hza": "#B8E8F0"},
	{"from": 15, "name": "The Fish",   "ref": "Jonah 1:17", "kind": "rib",
	 "sky": "#3E1E19", "far": "#2E1411", "mid": "#26100E", "gnd": "#1A0B0A",
	 "ob": "#9A5140", "obd": "#633026", "obt": "#C0705B", "hzg": "#E8DCC8", "hza": "#D8C8B0"},
	{"from": 30, "name": "Nineveh",    "ref": "Jonah 3:3",  "kind": "tower",
	 "sky": "#F2A65A", "far": "#E88C3F", "mid": "#D97B31", "gnd": "#A85E1C",
	 "ob": "#D9A441", "obd": "#9C7020", "obt": "#F0CB72", "hzg": "#2F6B33", "hza": "#E8503C"},
] as const;

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

export const DOVE_H = 10 as const;

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

export const STRINGS = {
	"en": {
		"play": "Play", "daily": "Daily Challenge", "wardrobe": "Wardrobe",
		"settings": "Settings", "leaderboard": "Leaderboard", "back": "Back",
		"audio": "Audio", "music": "Music", "sfx": "Sound effects", "haptics": "Haptics",
		"visual": "Visual", "atmosphere": "Atmosphere", "flashing": "Reduced flashing",
		"colourblind": "Colour-blind palette", "lefthand": "Left-handed HUD",
		"game": "Game", "difficulty": "Difficulty", "account": "Account",
		"playgames": "Google Play Games", "restore": "Restore purchases",
		"language": "Language", "legal": "Legal", "privacy": "Privacy policy",
		"terms": "Terms", "deletedata": "Delete my data", "licences": "Open-source licences",
		"about": "About", "version": "Version", "seed": "Last run seed",
		"off": "Off", "low": "Low", "full": "Full", "on": "On", "reduced": "Reduced",
		"easy": "Easy", "normal": "Normal", "hard": "Hard", "pro": "Pro",
		"owned": "Worn", "wear": "Wear", "locked": "Locked",
		"streak": "Streak", "best": "Best", "feathers": "Feathers",
		"tagline": "One touch. Storm, deep and sky.",
		"credits": "Credits", "madeby": "Made by", "builtwith": "Built with",
		"chapters": "Chapters", "website": "Website",
		"playername": "Player name", "savename": "Save name",
		"recovery": "Recovery", "getcode": "Get a recovery code",
		"entercode": "Recovery code", "restoreacct": "Restore my account",
		"respawns": "Respawns", "getrespawns": "Get respawns",
		"copycode": "Copy code", "paynow": "Pay with Paystack", "ihavepaid": "I have paid",
		"share": "Share", "sharebest": "Share my score",
		"suggest": "Suggest names", "keepname": "Keep my name",
		"choosename": "Choose your name", "wellflown": "Well flown",
		"days": "days", "streaksaved": "Streak saved", "streakboard": "Longest streaks",
	},
	"sw": {
		"play": "Cheza", "daily": "Changamoto ya Leo", "wardrobe": "Nguo",
		"settings": "Mipangilio", "leaderboard": "Ubao wa Alama", "back": "Rudi",
		"audio": "Sauti", "music": "Muziki", "sfx": "Sauti za mchezo", "haptics": "Mtetemo",
		"visual": "Mwonekano", "atmosphere": "Mazingira", "flashing": "Punguza mwangaza",
		"colourblind": "Rangi kwa upofu wa rangi", "lefthand": "Mkono wa kushoto",
		"game": "Mchezo", "difficulty": "Ugumu", "account": "Akaunti",
		"playgames": "Google Play Games", "restore": "Rejesha manunuzi",
		"language": "Lugha", "legal": "Kisheria", "privacy": "Sera ya faragha",
		"terms": "Masharti", "deletedata": "Futa data yangu", "licences": "Leseni huria",
		"about": "Kuhusu", "version": "Toleo", "seed": "Mbegu ya mchezo",
		"off": "Zima", "low": "Chini", "full": "Kamili", "on": "Washa", "reduced": "Punguza",
		"easy": "Rahisi", "normal": "Kawaida", "hard": "Ngumu", "pro": "Bingwa",
		"owned": "Imevaliwa", "wear": "Vaa", "locked": "Imefungwa",
		"streak": "Mfululizo", "best": "Bora", "feathers": "Manyoya",
		"tagline": "Mguso mmoja. Dhoruba, kina na anga.",
		
		
		"credits": "Waliohusika", "madeby": "Imetengenezwa na",
		"builtwith": "Imejengwa kwa", "chapters": "Sura", "website": "Tovuti",
		"playername": "Jina la mchezaji", "savename": "Hifadhi jina",
		"recovery": "Kurejesha", "getcode": "Pata msimbo wa kurejesha",
		"entercode": "Msimbo wa kurejesha", "restoreacct": "Rejesha akaunti yangu",
		"respawns": "Nafasi zaidi", "getrespawns": "Pata nafasi zaidi",
		"copycode": "Nakili msimbo", "paynow": "Lipa kwa Paystack", "ihavepaid": "Nimelipa",
		"share": "Shiriki", "sharebest": "Shiriki alama yangu",
		"suggest": "Pendekeza majina", "keepname": "Baki na jina langu",
		"choosename": "Chagua jina lako", "wellflown": "Safari njema",
		"days": "siku", "streaksaved": "Mfululizo umeokolewa", "streakboard": "Mifululizo mirefu",
	},
} as const;

export const DOVE_FRAMES = [
	
	[
	"....DDDDDD......",
	"..DDWWWWWWDD....",
	".DWWGGGGWWWWD...",
	".DWGGGGGWWEEWD..",
	"DWGGGGGGWWWEEWDD",
	"DWWGGGGGWWWWWWDO",
	".DWWWWWWWWWWWWDO",
	"..DWWWWWWWWWWD..",
	"...DDWWWWWWDD...",
	".....DDDDDD.....",
	],
	
	[
	"....DDDDDD......",
	"..DDWWWWWWDD....",
	".DWWWWWWWWWWD...",
	".DWWWWWWWEEWWD..",
	"DWGGGGGWWWEEWWDD",
	"DWGGGGGGWWWWWWDO",
	"DWGGGGGGWWWWWWDO",
	".DWWWWWWWWWWWD..",
	"..DDWWWWWWDD....",
	"....DDDDDD......",
	],
	
	[
	"......DDDD......",
	"...DDWWWWWWD....",
	"..DWWWWWWWWWD...",
	".DWWWWWWWEEWWD..",
	"DWWWWWWWWWEEWWDD",
	"DWWWWWWWWWWWWWDO",
	".DWGGGGGWWWWWDO.",
	".DWGGGGGGWWWWD..",
	"..DWGGGGGGWWD...",
	"...DDWWWWWWD....",
	],
	
	[
	".....DDDDD......",
	"..DDWWWWWWWD....",
	".DWWWWWWWWWWD...",
	".DWWWWWWWEEWWD..",
	"DWWGGGGWWWEEWWDD",
	"DWGGGGGGWWWWWWDO",
	"DWGGGGGGWWWWWWDO",
	".DWWGGGWWWWWWD..",
	"..DDWWWWWWDD....",
	"....DDDDDD......",
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
