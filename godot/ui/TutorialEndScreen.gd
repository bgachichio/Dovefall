extends Control
## The end of the first flight.
##
## By now the player has tapped to fly, scored, died, and used the free
## respawn the arrow pointed at. Two things remain that cannot be taught by
## playing: sharing a score, and knowing the recovery code exists. One tap
## each, then out of their way forever.

signal finished

var score := 0
var _status: Label


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	_build()


func _build() -> void:
	var col := UiKit.screen("wellflown")

	col.add_child(UiKit.field_display(str(score)))

	col.add_child(UiKit.note(
		"That heart is a respawn — it clears the sky ahead and the flight goes "
		+ "on. You get more in the shop, and runs that use one earn feathers "
		+ "but stay off the leaderboard."))

	var share := UiKit.button(Config.t("sharebest"), true)
	share.pressed.connect(_on_share)
	col.add_child(share)

	_status = UiKit.note("")
	col.add_child(_status)

	col.add_child(UiKit.spacer(8))
	col.add_child(UiKit.note(
		"One more thing: your progress lives on this phone. Settings → Account "
		+ "gives you a recovery code — the only way back if you lose it. We "
		+ "never ask for your email."))

	col.add_child(UiKit.spacer(16))
	var go := UiKit.button(Config.t("play"), true)
	go.pressed.connect(_on_finish)
	col.add_child(go)

	add_child(UiKit.page(col))


func _on_share() -> void:
	_status.text = "Making your card…"
	ShareCard.capture_and_share(self, score, str(SaveData.get_setting("mode", "normal")), _on_shared)


func _on_shared(ok: bool) -> void:
	_status.text = "Shared." if ok else \
		"Card saved. The link is on your clipboard — paste it anywhere."
	Analytics.log_event("share", {"generated": true, "completed": ok, "score": score})


func _on_finish() -> void:
	finished.emit()
