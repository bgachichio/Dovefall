extends SceneTree
## Emits golden vectors for the server's physics port.
##
## Run under a real Godot build:
##
##     godot --headless --script tools/golden_vectors.gd > golden.json
##
## then drop `golden.json` into `worker/test/` and the replay validator's test
## suite can assert the JavaScript port agrees with the engine, seed by seed.
##
## WHY THIS EXISTS
##
## The server currently checks that a score is *arithmetically possible* for the
## run's duration. It does not replay the run, because replaying it needs a
## second implementation of the physics, and two implementations that must agree
## bit-for-bit will eventually stop agreeing. The day they do, the leaderboard
## becomes fiction and nobody notices.
##
## This file is the alarm. It is the difference between "two implementations
## that might drift" and "two implementations with a drift detector", and it is
## the precondition for turning replay validation on at all.


func _init() -> void:
	var out := {
		"generated_by": "godot",
		"engine": Engine.get_version_info()["string"],
		"config_version": Config.VERSION,
		"determinism_check": _determinism_check(),
		"rng_streams": _rng_streams(),
	}
	print(JSON.stringify(out, "  "))
	quit()


## Must equal 4075699207, and must equal what worker/src/rng.js computes.
## This is the anchor the whole arrangement hangs from.
func _determinism_check() -> int:
	var keep := Rng.current_seed
	Rng.seed_run(0xD0FE)
	var m: Dictionary = Config.MODES["normal"]
	var y := 0.0
	var v := 0.0
	var acc := 0
	for i in 600:
		if i % 37 == 0:
			v = -m["flap"]
		v = minf(v + m["grav"] * Config.FIXED, m["grav"] * Config.TERMINAL_MULT)
		y += v * Config.FIXED
		acc = (acc + Rng.next()) & 0xFFFFFFFF
	Rng.seed_run(keep)
	return (int(absf(y) * 1000.0) ^ acc) & 0xFFFFFFFF


## Raw generator output for a spread of seeds. Any divergence between the engine
## and the port shows up here before it can reach a score.
func _rng_streams() -> Array:
	var seeds := [1, 0xD0FE, 0xFFFFFFFF, 20260828, 123456789]
	var out := []
	for s in seeds:
		Rng.seed_run(int(s))
		var draws := []
		for i in 64:
			draws.append(Rng.next())
		out.append({"seed": int(s), "first_64": draws})
	return out
