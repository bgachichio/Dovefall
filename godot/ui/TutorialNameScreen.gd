extends Control
## The first thing a new player ever sees: choose a name, one tap.
##
## The tutorial proper happens IN the game — this screen exists only because a
## name is a menu decision, and it is the one moment the whole player base
## passes through. Three suggestions, or keep the default; typing is possible
## later in Settings → Account, never demanded here.

signal done

## Offline fallback, so the very first launch works on a plane. Same
## vocabulary as the server's generator.
const FALLBACK_FIRST := ["Storm", "Deep", "Sky", "Dawn", "Ember", "Swift", "Coral", "Wind"]
const FALLBACK_SECOND := ["Dove", "Wing", "Feather", "Glider", "Sparrow", "Scout", "Voyager", "Skylark"]

var _buttons: VBoxContainer
var _status: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	Net.names_suggested.connect(_on_suggested)
	_build()
	if Net.enabled():
		Net.suggest_names()
	else:
		_on_suggested([])


func _exit_tree() -> void:
	if Net.names_suggested.is_connected(_on_suggested):
		Net.names_suggested.disconnect(_on_suggested)


func _build() -> void:
	var col := UiKit.screen("choosename")

	col.add_child(UiKit.spacer(6))
	col.add_child(UiKit.dove_texture(Config.skin_by_id("dove"), 9))
	col.add_child(UiKit.spacer(6))

	col.add_child(UiKit.note(
		"This is who you are on the leaderboard. Pick one — you can change it "
		+ "any time in Settings."))

	_buttons = VBoxContainer.new()
	_buttons.add_theme_constant_override("separation", 10)
	col.add_child(_buttons)

	_status = UiKit.note("")
	col.add_child(_status)

	col.add_child(UiKit.spacer(10))
	var keep := UiKit.button(_keep_label())
	keep.pressed.connect(_on_keep)
	col.add_child(keep)

	add_child(UiKit.page(col))


func _keep_label() -> String:
	var name := str(Net.player.get("name", ""))
	var tag := str(Net.player.get("tag", ""))
	if name != "" and tag != "":
		return "%s  ·  %s#%s" % [Config.t("keepname"), name, tag]
	return Config.t("keepname")


func _on_suggested(names: Array) -> void:
	var offer: Array = names
	if offer.is_empty():
		offer = _local_names()
	for c in _buttons.get_children():
		c.queue_free()
	for n in offer:
		var b := UiKit.button(str(n), true)
		b.pressed.connect(_on_pick.bind(str(n)))
		_buttons.add_child(b)


func _local_names() -> Array:
	var out: Array = []
	var used := {}
	while out.size() < 3:
		var n := "%s %s" % [FALLBACK_FIRST.pick_random(), FALLBACK_SECOND.pick_random()]
		if not used.has(n):
			used[n] = true
			out.append(n)
	return out


func _on_pick(name: String) -> void:
	if Net.enabled():
		Net.set_player_name(name)
	done.emit()


func _on_keep() -> void:
	done.emit()
