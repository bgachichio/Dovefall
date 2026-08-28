extends Control
## The public leaderboard, and the share moment.
##
## Boards are advisory UI: a failed fetch shows "no scores yet", never a
## spinner that hangs. Your own row is picked out by tag, not by name —
## names are not unique here, tags are.

signal closed

const KINDS := ["easy", "normal", "hard", "pro", "daily", "streaks"]

var _kind := "normal"
var _list: VBoxContainer
var _status: Label
var _mine: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	Net.board_loaded.connect(_on_board)
	_kind = str(SaveData.get_setting("mode", "normal"))
	_build()
	_reload()


func _exit_tree() -> void:
	if Net.board_loaded.is_connected(_on_board):
		Net.board_loaded.disconnect(_on_board)


func _build() -> void:
	var col := UiKit.screen("leaderboard")

	if not Net.enabled():
		col.add_child(UiKit.note(
			"This build has no server configured, so the board shows your own "
			+ "bests from this device."))

	var labels := [Config.t("easy"), Config.t("normal"), Config.t("hard"),
		Config.t("pro"), Config.t("daily"), Config.t("streak")]
	col.add_child(UiKit.choice(Config.t("difficulty"), labels,
		maxi(0, KINDS.find(_kind)), _on_kind))

	_mine = UiKit.note("")
	col.add_child(_mine)

	_status = UiKit.note("")
	col.add_child(_status)

	_list = VBoxContainer.new()
	_list.add_theme_constant_override("separation", 4)
	col.add_child(_list)

	col.add_child(UiKit.spacer(16))
	var share := UiKit.button(Config.t("sharebest"), true)
	share.pressed.connect(_on_share)
	col.add_child(share)

	var back := UiKit.button(Config.t("back"))
	back.pressed.connect(func(): closed.emit())
	col.add_child(back)

	add_child(UiKit.page(col))


func _on_kind(i: int) -> void:
	_kind = KINDS[i]
	_reload()


func _reload() -> void:
	for c in _list.get_children():
		c.queue_free()
	_refresh_mine()

	if not Net.enabled():
		_status.text = ""
		_local_rows()
		return

	_status.text = "…"
	if _kind == "daily":
		Net.load_daily_board()
	elif _kind == "streaks":
		Net.load_streak_board()
	else:
		Net.load_board(_kind)


func _refresh_mine() -> void:
	var best := _my_best()
	var glyph := "\u25C6" if _kind == "streaks" else "\u2605"
	var name := str(Net.player.get("name", "")) if Net.enabled() else ""
	var tag := str(Net.player.get("tag", ""))
	if name != "" and tag != "":
		_mine.text = "%s#%s  \u00B7  %s %d" % [name, tag, glyph, best]
	else:
		_mine.text = "%s %d" % [glyph, best]


func _my_best() -> int:
	if _kind == "daily":
		return int(SaveData.data.get("daily", {}).get("score", 0))
	if _kind == "streaks":
		return int(Net.streaks.get("daily", {}).get("best", 0))
	return SaveData.best_for(_kind)


## Without a server, the board is your own four bests — still worth a screen.
func _local_rows() -> void:
	for m in Config.MODE_ORDER:
		_list.add_child(_row(0, "%s" % Config.t(m), "", SaveData.best_for(m), false))


func _on_board(kind: String, entries: Array) -> void:
	if kind != _kind:
		return
	_status.text = "" if entries.size() > 0 else "No scores yet. Set one."
	for c in _list.get_children():
		c.queue_free()
	var my_tag := str(Net.player.get("tag", ""))
	for e in entries:
		if typeof(e) != TYPE_DICTIONARY:
			continue
		_list.add_child(_row(int(e.get("rank", 0)), str(e.get("name", "")),
			str(e.get("tag", "")), int(e.get("score", 0)),
			my_tag != "" and str(e.get("tag", "")) == my_tag))


func _row(rank: int, name: String, tag: String, score: int, mine: bool) -> Control:
	var h := HBoxContainer.new()
	h.add_theme_constant_override("separation", 14)

	var col := Config.GOLD if mine else Config.PAPER
	var dim := Color(0.62, 0.70, 0.82)

	var r := Label.new()
	r.text = "%d" % rank if rank > 0 else ""
	r.custom_minimum_size.x = 70
	r.add_theme_font_size_override("font_size", 30)
	r.add_theme_color_override("font_color", dim)
	h.add_child(r)

	var n := Label.new()
	n.text = name if tag == "" else "%s#%s" % [name, tag]
	n.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	n.clip_text = true
	n.add_theme_font_size_override("font_size", 30)
	n.add_theme_color_override("font_color", col)
	h.add_child(n)

	var s := Label.new()
	s.text = str(score)
	s.add_theme_font_size_override("font_size", 30)
	s.add_theme_color_override("font_color", col)
	h.add_child(s)
	return h


func _on_share() -> void:
	var score := _my_best()
	if score <= 0:
		_status.text = "Fly a run first — then there is a score to share."
		return
	if _kind == "streaks":
		_status.text = "Share your score from a difficulty board."
		return
	_status.text = "Making your card…"
	ShareCard.capture_and_share(self, score, _kind, _on_shared)


func _on_shared(ok: bool) -> void:
	_status.text = "Shared." if ok else \
		"Card saved. The link is on your clipboard — paste it anywhere."
	Analytics.log_event("share", {"generated": true, "completed": ok, "score": _my_best()})
