extends Node
## Talks to the Dovefall API (Cloudflare Worker + D1).
##
## LOCAL-FIRST, ALWAYS. SaveData on disk is the source of truth; everything here
## is a convenience layered on top. If the network is gone, the player is on a
## plane, or the Worker is down, the game must play exactly as well as it does
## now. Nothing in this file is ever awaited by the game loop.
##
## Set API_BASE to your deployed Worker before shipping. Until it is set, every
## call short-circuits and the game is simply offline — which is a correct state,
## not an error state.

const API_BASE := ""  # e.g. "https://dovefall-api.gachichio.workers.dev"

const TOKEN_PATH := "user://session.token"
const QUEUE_PATH := "user://pending_runs.json"
const TIMEOUT_S := 10.0
const MAX_QUEUED_RUNS := 20

signal signed_in(player: Dictionary)
signal sign_in_failed(reason: String)
signal board_loaded(kind: String, entries: Array)
signal run_submitted(accepted: bool, personal_best: bool)
signal save_pulled(rev: int, blob: String)

var token := ""
var player := {}
var online := false

var _pending: Array = []
var _flushing := false


func _ready() -> void:
	if not enabled():
		return
	_read_token()
	_read_queue()
	if token == "":
		sign_in_guest()
	else:
		online = true
		_flush_queue()


func enabled() -> bool:
	return API_BASE != ""


func is_guest() -> bool:
	return player.get("guest", true)


# ------------------------------------------------------------------ identity

## Anonymous play. No personal data leaves the device — the id is the same
## random install id that keys the local save.
func sign_in_guest() -> void:
	if not enabled():
		return
	_post("/v1/auth/guest", {"device_id": SaveData.install_id()}, _on_signed_in)


## Upgrade a guest to a real account, or sign in an existing one. `id_token` is
## a Google ID token from Play Games Services (Android) or Google Identity
## Services (web).
func sign_in_google(id_token: String) -> void:
	if not enabled():
		return
	if token == "":
		_post("/v1/auth/google", {"id_token": id_token}, _on_signed_in)
	else:
		_post("/v1/auth/link", {"id_token": id_token}, _on_signed_in, true)


func sign_out() -> void:
	token = ""
	player = {}
	online = false
	DirAccess.remove_absolute(TOKEN_PATH)


func _on_signed_in(code: int, body: Dictionary) -> void:
	if code < 200 or code >= 300:
		online = false
		sign_in_failed.emit(str(body.get("message", "Could not sign in.")))
		return
	if body.has("token"):
		token = str(body["token"])
		_write_token()
	if body.has("player"):
		player = body["player"]
	online = true
	signed_in.emit(player)
	_flush_queue()


# ------------------------------------------------------------------ runs

## Called from Game.gd on death. Never blocks, never fails loudly. A run that
## cannot be sent now is queued and retried on the next launch, so a player who
## sets a personal best in a tunnel still gets it on the board.
func submit_run(run: Dictionary) -> void:
	if not enabled():
		return
	_pending.append(run)
	if _pending.size() > MAX_QUEUED_RUNS:
		_pending = _pending.slice(_pending.size() - MAX_QUEUED_RUNS)
	_write_queue()
	_flush_queue()


func _flush_queue() -> void:
	if _flushing or token == "" or _pending.is_empty():
		return
	_flushing = true
	var run: Dictionary = _pending[0]
	_post("/v1/runs", run, _on_run_submitted, true)


func _on_run_submitted(code: int, body: Dictionary) -> void:
	_flushing = false

	# 2xx means stored. 4xx means the server has judged it and will judge it the
	# same way tomorrow, so drop it rather than retrying forever. Only 5xx and
	# transport failures are worth keeping.
	if code >= 200 and code < 500:
		if not _pending.is_empty():
			_pending.pop_front()
		_write_queue()
		run_submitted.emit(bool(body.get("accepted", false)), bool(body.get("personal_best", false)))
		if not _pending.is_empty():
			_flush_queue()
	else:
		online = false


# ------------------------------------------------------------------ boards

func load_board(mode: String) -> void:
	if not enabled():
		return
	_get("/v1/board/%s" % mode, _on_board.bind(mode))


func load_daily_board() -> void:
	if not enabled():
		return
	_get("/v1/board/daily", _on_board.bind("daily"))


## Boards are advisory. A failed fetch emits an empty list so the screen can say
## "no scores yet" rather than hanging on a spinner.
func _on_board(code: int, body: Dictionary, kind: String) -> void:
	var entries: Array = body.get("entries", []) if code == 200 else []
	board_loaded.emit(kind, entries)


# ------------------------------------------------------------------ cloud save

## Push at most on app background and on a personal best — the server throttles
## to one write every 30 seconds and the free plan's write budget is the scarce
## resource, not bandwidth.
func push_save(rev: int) -> void:
	if not enabled() or token == "":
		return
	_put("/v1/save", {"rev": rev, "blob": JSON.stringify(SaveData.data)}, _on_save_pushed)


func pull_save() -> void:
	if not enabled() or token == "":
		return
	_get("/v1/save", _on_save_pulled)


## A 429 here is the server asking us to sync less often, not an error.
func _on_save_pushed(_code: int, _body: Dictionary) -> void:
	pass


func _on_save_pulled(code: int, body: Dictionary) -> void:
	if code == 200 and body.get("blob") != null:
		save_pulled.emit(int(body.get("rev", 0)), str(body["blob"]))


# ------------------------------------------------------------------ transport

func _get(path: String, done: Callable, auth: bool = true) -> void:
	_send(HTTPClient.METHOD_GET, path, "", done, auth)


func _post(path: String, body: Dictionary, done: Callable, auth: bool = false) -> void:
	_send(HTTPClient.METHOD_POST, path, JSON.stringify(body), done, auth)


func _put(path: String, body: Dictionary, done: Callable, auth: bool = true) -> void:
	_send(HTTPClient.METHOD_PUT, path, JSON.stringify(body), done, auth)


## One HTTPRequest node per call, freed on completion. At this volume — a
## handful of calls per session — a pool would be complexity without a payer.
func _send(method: int, path: String, body: String, done: Callable, auth: bool) -> void:
	var http := HTTPRequest.new()
	http.timeout = TIMEOUT_S
	add_child(http)

	var headers := PackedStringArray(["Content-Type: application/json"])
	if auth and token != "":
		headers.append("Authorization: Bearer " + token)

	http.request_completed.connect(func(result: int, code: int, _h: PackedStringArray, raw: PackedByteArray):
		http.queue_free()
		var parsed := {}
		if raw.size() > 0:
			var v = JSON.parse_string(raw.get_string_from_utf8())
			if typeof(v) == TYPE_DICTIONARY:
				parsed = v
		if result != HTTPRequest.RESULT_SUCCESS:
			online = false
			done.call(0, {})
			return
		# The session has expired or been revoked; fall back to a guest identity
		# rather than leaving the player silently unable to post a score.
		if code == 401 and auth:
			token = ""
			_write_token()
			call_deferred("sign_in_guest")
		done.call(code, parsed))

	var err := http.request(API_BASE + path, headers, method, body)
	if err != OK:
		http.queue_free()
		online = false
		done.call(0, {})


# ------------------------------------------------------------------ persistence

func _read_token() -> void:
	if not FileAccess.file_exists(TOKEN_PATH):
		return
	var f := FileAccess.open(TOKEN_PATH, FileAccess.READ)
	if f == null:
		return
	token = f.get_as_text().strip_edges()
	f.close()


func _write_token() -> void:
	var f := FileAccess.open(TOKEN_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(token)
	f.close()


func _read_queue() -> void:
	if not FileAccess.file_exists(QUEUE_PATH):
		return
	var f := FileAccess.open(QUEUE_PATH, FileAccess.READ)
	if f == null:
		return
	var v = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(v) == TYPE_ARRAY:
		_pending = v


func _write_queue() -> void:
	var f := FileAccess.open(QUEUE_PATH, FileAccess.WRITE)
	if f == null:
		return
	f.store_string(JSON.stringify(_pending))
	f.close()
