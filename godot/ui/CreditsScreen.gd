extends Control
## Credits.
##
## Attribution, and the licences the engine's licence asks for. Reachable from
## the title screen rather than buried in Settings, because a one-person game
## should say so plainly.

signal closed

const SITE_URL := "https://gachichio.org"
const CONTACT := "brian@gachichio.org"


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(UiKit.backdrop())
	_build()


func _build() -> void:
	var col := UiKit.screen("credits")

	col.add_child(UiKit.spacer(8))
	col.add_child(UiKit.dove_texture(Config.skin_by_id(SaveData.data.get("worn", "dove")), 7))
	col.add_child(UiKit.spacer(16))

	# ------------------------------------------------------------- author
	col.add_child(UiKit.section(Config.t("madeby")))
	col.add_child(_line("Brian Gachichio Karanja", 40, Config.PAPER))
	col.add_child(_line("Design, code, art and music", 26, Color(0.62, 0.70, 0.82)))
	col.add_child(_line("Nairobi, Kenya", 26, Config.GOLD))

	col.add_child(UiKit.spacer(10))
	var site := UiKit.button(Config.t("website"))
	site.pressed.connect(func(): OS.shell_open(SITE_URL))
	col.add_child(site)

	var mail := UiKit.button(CONTACT)
	mail.pressed.connect(func(): OS.shell_open("mailto:" + CONTACT))
	col.add_child(mail)

	# ------------------------------------------------------------- built with
	col.add_child(UiKit.section(Config.t("builtwith")))
	col.add_child(UiKit.note(
		"Godot Engine, under the MIT licence. Every sprite is drawn in code and "
		+ "every sound is synthesised at run time, so nothing here was sampled, "
		+ "licensed or borrowed."))

	var lic := UiKit.button(Config.t("licences"))
	lic.pressed.connect(func(): OS.shell_open(SITE_URL + "/dovefall/licences"))
	col.add_child(lic)

	# ------------------------------------------------------------- the spine
	col.add_child(UiKit.section(Config.t("chapters")))
	var refs := ""
	for c in Config.CHAPTERS:
		refs += "%s  ·  %s\n" % [c["name"], c["ref"]]
	col.add_child(UiKit.note(refs.strip_edges()))
	col.add_child(UiKit.note(
		"Referenced, never quoted. A reference is a fact, and facts belong to "
		+ "no one."))

	# ------------------------------------------------------------- version
	col.add_child(UiKit.section(Config.t("about")))
	col.add_child(_line("%s %s" % [Config.t("version"), Config.VERSION], 26,
		Color(0.62, 0.70, 0.82)))
	if Rng.current_seed != 0:
		col.add_child(_line("%s %s" % [Config.t("seed"), Rng.seed_code()], 26,
			Color(0.62, 0.70, 0.82)))

	col.add_child(UiKit.spacer(28))
	var back := UiKit.button(Config.t("back"), true)
	back.pressed.connect(func(): closed.emit())
	col.add_child(back)

	add_child(UiKit.page(col))


func _line(text: String, size: int, colour: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	return l
