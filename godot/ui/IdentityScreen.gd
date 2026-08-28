extends Control
## Who the player is, and how they get back in.
##
## No email address is ever asked for. Identity is three things:
##
##   1. A name the player chooses. Not unique — being told your name is taken is
##      a bad first thirty seconds — so a short tag distinguishes two Brians.
##   2. A random id held on the device, minted on first launch. It is what the
##      server matches, and it is the same id that keys the local save.
##   3. A recovery code, written down. That is the whole answer to "I got a new
##      phone", and the only reason most games ask for an email at all.
##
## Google sign-in is offered but never required, and even then we keep the
## subject identifier and not the address.

signal closed

var _name_field: LineEdit
var _code_field: LineEdit
var _status: Label
var _code_display: Label
var _suggestions: VBoxContainer


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	Net.signed_in.connect(_on_signed_in)
	Net.sign_in_failed.connect(_on_failed)
	Net.names_suggested.connect(_on_names)
	_build()


func _exit_tree() -> void:
	if Net.signed_in.is_connected(_on_signed_in):
		Net.signed_in.disconnect(_on_signed_in)
	if Net.sign_in_failed.is_connected(_on_failed):
		Net.sign_in_failed.disconnect(_on_failed)
	if Net.names_suggested.is_connected(_on_names):
		Net.names_suggested.disconnect(_on_names)


func _build() -> void:
	var col := UiKit.screen("account")

	if not Net.enabled():
		col.add_child(UiKit.note(
			"This build has no server configured, so scores stay on this device. "
			+ "Everything still works; nothing is shared."))
		col.add_child(UiKit.spacer(20))
		col.add_child(_back_button())
		add_child(UiKit.page(col))
		return

	# ------------------------------------------------------------- name
	col.add_child(UiKit.section(Config.t("playername")))
	_name_field = UiKit.field(Config.t("playername"), str(Net.player.get("name", "")), 24)
	col.add_child(_name_field)

	var tag := str(Net.player.get("tag", ""))
	if tag != "":
		col.add_child(UiKit.note(
			"You appear on the leaderboard as %s#%s. The tag is yours and never "
			% [str(Net.player.get("name", "")), tag]
			+ "changes, so nobody can pass themselves off as you."))

	var save_name := UiKit.button(Config.t("savename"), true)
	save_name.pressed.connect(_on_save_name)
	col.add_child(save_name)

	var sug := UiKit.button(Config.t("suggest"))
	sug.pressed.connect(_on_suggest)
	col.add_child(sug)

	_suggestions = VBoxContainer.new()
	_suggestions.add_theme_constant_override("separation", 8)
	col.add_child(_suggestions)

	# ------------------------------------------------------------- recovery
	col.add_child(UiKit.section(Config.t("recovery")))
	col.add_child(UiKit.note(
		"Your progress lives on this device. If you lose it, a recovery code is "
		+ "the only way back — we never ask for your email, so there is nothing "
		+ "else to look you up by. Write the code down somewhere real."))

	_code_display = UiKit.field_display("")
	_code_display.visible = false
	col.add_child(_code_display)

	var issue := UiKit.button(Config.t("getcode"))
	issue.pressed.connect(_on_issue_code)
	col.add_child(issue)

	col.add_child(UiKit.spacer(10))
	col.add_child(UiKit.note("Moving to a new phone? Enter your code here."))
	_code_field = UiKit.field(Config.t("entercode"), "", 19)
	col.add_child(_code_field)

	var claim := UiKit.button(Config.t("restoreacct"))
	claim.pressed.connect(_on_claim_code)
	col.add_child(claim)

	# ------------------------------------------------------------- status
	col.add_child(UiKit.spacer(14))
	_status = UiKit.note("")
	col.add_child(_status)

	col.add_child(UiKit.spacer(24))
	col.add_child(_back_button())
	add_child(UiKit.page(col))


func _back_button() -> Button:
	var b := UiKit.button(Config.t("back"), true)
	b.pressed.connect(func(): closed.emit())
	return b


# ------------------------------------------------------------------ actions

func _on_save_name() -> void:
	var wanted := _name_field.text.strip_edges()
	if wanted.is_empty():
		_say("Pick a name with at least one visible character.")
		return
	Net.set_player_name(wanted)
	_say("Saving…")


func _on_suggest() -> void:
	_say("Thinking\u2026")
	Net.suggest_names()


## Three names, each confirmed unused at the moment of asking. Tapping one
## saves it immediately — the suggestion IS the confirmation.
func _on_names(names: Array) -> void:
	_say("")
	for c in _suggestions.get_children():
		c.queue_free()
	if names.is_empty():
		_say("Could not fetch suggestions. Type a name instead.")
		return
	for n in names:
		var b := UiKit.button(str(n))
		b.pressed.connect(_on_pick_name.bind(str(n)))
		_suggestions.add_child(b)


func _on_pick_name(name: String) -> void:
	_name_field.text = name
	Net.set_player_name(name)
	_say("Saving\u2026")


func _on_issue_code() -> void:
	Net.issue_recovery_code(_on_code_ready)


func _on_code_ready(code: String) -> void:
	if code == "":
		_say("Could not reach the server. Try again when you are online.")
		return
	_code_display.text = code
	_code_display.visible = true
	DisplayServer.clipboard_set(code)
	_say("Copied. This code is shown once and works once — write it down.")


func _on_claim_code() -> void:
	var code := _code_field.text.strip_edges()
	if code.length() < 15:
		_say("That code looks too short.")
		return
	Net.claim_recovery_code(code, _on_code_claimed)


func _on_code_claimed(ok: bool, message: String) -> void:
	_say(message)
	if ok:
		_code_field.text = ""
		_name_field.text = str(Net.player.get("name", ""))


func _on_signed_in(p: Dictionary) -> void:
	if _name_field != null:
		_name_field.text = str(p.get("name", ""))
	_say("")


func _on_failed(reason: String) -> void:
	_say(reason)


func _say(text: String) -> void:
	if _status != null:
		_status.text = text
