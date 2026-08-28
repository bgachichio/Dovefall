extends Control
## Buying respawns.
##
## The purchase happens on the hosted Paystack page, in the browser — the game
## never touches card numbers or M-PESA prompts. All this screen does is show
## the player their code, open the page, and refresh the balance after they
## come back. The server credits nothing until Paystack's signed webhook lands.
##
## Money words live HERE, in a menu, never in the wordless core loop.

signal closed

var _balance_label: Label
var _status: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	Net.respawns_changed.connect(_on_balance)
	_build()
	Net.refresh_respawns()


func _exit_tree() -> void:
	if Net.respawns_changed.is_connected(_on_balance):
		Net.respawns_changed.disconnect(_on_balance)


func _build() -> void:
	var col := UiKit.screen("respawns")

	_balance_label = UiKit.field_display("♥ %d" % Net.respawns)
	col.add_child(_balance_label)

	col.add_child(UiKit.note(
		"A respawn lets you keep flying after a hit — the sky ahead is cleared "
		+ "and the run continues. Continued runs earn feathers but are not "
		+ "ranked on the leaderboard, so the board stays honest."))

	col.add_child(UiKit.section(Config.t("getrespawns")))
	col.add_child(UiKit.note(
		"Pay at least KES 50 and you get 3 respawns. At checkout, enter your "
		+ "player code so we know who to credit:"))

	col.add_child(UiKit.field_display(_spaced(Net.pay_code)))

	var copy := UiKit.button(Config.t("copycode"))
	copy.pressed.connect(_on_copy)
	col.add_child(copy)

	var pay := UiKit.button(Config.t("paynow"), true)
	pay.pressed.connect(_on_pay)
	col.add_child(pay)

	col.add_child(UiKit.spacer(8))
	var refresh := UiKit.button(Config.t("ihavepaid"))
	refresh.pressed.connect(_on_refresh)
	col.add_child(refresh)

	_status = UiKit.note("")
	col.add_child(_status)

	col.add_child(UiKit.spacer(20))
	var back := UiKit.button(Config.t("back"), true)
	back.pressed.connect(func(): closed.emit())
	col.add_child(back)

	add_child(UiKit.page(col))


## XXXX XXXX reads better on a phone keyboard than eight run-together glyphs.
func _spaced(code: String) -> String:
	if code.length() != 8:
		return code
	return code.substr(0, 4) + " " + code.substr(4, 4)


func _on_copy() -> void:
	if Net.pay_code != "":
		DisplayServer.clipboard_set(Net.pay_code)
		_status.text = "Copied."


func _on_pay() -> void:
	if Net.pay_code == "":
		_status.text = "Could not reach the server. Try again when you are online."
		return
	DisplayServer.clipboard_set(Net.pay_code)
	_status.text = "Your code is copied — paste it into the Player code field at checkout."
	Net.open_pay_page()


func _on_refresh() -> void:
	_status.text = "Checking…"
	Net.refresh_respawns()


func _on_balance(balance: int) -> void:
	if _balance_label != null:
		_balance_label.text = "♥ %d" % balance
	if _status != null and _status.text == "Checking…":
		_status.text = "Balance updated." if balance > 0 else \
			"Nothing yet. M-PESA can take a moment — try again shortly."
