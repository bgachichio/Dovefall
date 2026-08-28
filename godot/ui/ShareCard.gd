class_name ShareCard
extends RefCounted
## Renders a score card and hands it to the platform's share sheet.
##
## 1080×1920 — story-shaped, which is where these travel: WhatsApp status,
## Instagram stories, TikTok. The card is drawn by the game itself (the same
## dove, the same palette), so every share is on-brand without an asset.
##
## Platform reality, stated plainly:
##   Web     — navigator.share with the image file where the browser allows it
##             (Chrome on Android does), text+link otherwise. Must be called
##             from a tap, which it is.
##   Android — Godot has no built-in share sheet. Until the share plugin is
##             added (see DEPLOY.md), the card is saved and the link goes to
##             the clipboard. The plugin slot is share_native() below.
##   Desktop — card saved next to the save file; link on the clipboard.

const W := 1080
const H := 1920
const CARD_PATH := "user://dovefall-share.png"


## Renders, then shares. `done` receives true when a share sheet opened,
## false when we fell back to save-and-copy — the caller words its status
## line accordingly.
static func capture_and_share(host: Node, score: int, kind: String, done: Callable) -> void:
	var vp := SubViewport.new()
	vp.size = Vector2i(W, H)
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	vp.add_child(_card(score, kind))
	host.add_child(vp)
	# Two frames: one to lay out the controls, one to draw them.
	await host.get_tree().process_frame
	await host.get_tree().process_frame
	var img := vp.get_texture().get_image()
	vp.queue_free()
	done.call(_share(img, score))


# ------------------------------------------------------------------ the card

static func _card(score: int, kind: String) -> Control:
	var root := ColorRect.new()
	root.color = Config.NAVY
	root.custom_minimum_size = Vector2(W, H)
	root.set_anchors_preset(Control.PRESET_FULL_RECT)

	# A deeper band at the base, echoing the game's ground.
	var ground := ColorRect.new()
	ground.color = Config.INK
	ground.anchor_top = 0.82
	ground.anchor_bottom = 1.0
	ground.anchor_right = 1.0
	root.add_child(ground)

	var center := CenterContainer.new()
	center.set_anchors_preset(Control.PRESET_FULL_RECT)
	root.add_child(center)

	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 26)
	col.alignment = BoxContainer.ALIGNMENT_CENTER
	center.add_child(col)

	col.add_child(_label("DOVEFALL", 96, Config.GOLD))
	col.add_child(_label(Config.t("tagline"), 34, Color(0.93, 0.96, 1.0, 0.75)))

	var dove := UiKit.dove_texture(Config.skin_by_id(SaveData.data.get("worn", "dove")), 26)
	dove.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	col.add_child(dove)

	col.add_child(_label(str(score), 260, Config.PAPER))

	var who := str(Net.player.get("name", ""))
	var tag := str(Net.player.get("tag", ""))
	if who != "" and tag != "":
		col.add_child(_label("%s#%s  ·  %s" % [who, tag, Config.t(kind)], 36, Config.GOLD))
	else:
		col.add_child(_label(Config.t(kind), 36, Config.GOLD))

	col.add_child(_spacer(60))
	col.add_child(_label(_pretty_url(), 44, Config.PAPER))
	return root


static func _label(text: String, size: int, colour: Color) -> Label:
	var l := Label.new()
	l.text = text
	l.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	l.add_theme_font_size_override("font_size", size)
	l.add_theme_color_override("font_color", colour)
	return l


static func _spacer(h: int) -> Control:
	var c := Control.new()
	c.custom_minimum_size.y = h
	return c


static func _pretty_url() -> String:
	return Net.SHARE_URL.replace("https://", "").replace("http://", "")


# ------------------------------------------------------------------ sharing

static func _share(img: Image, score: int) -> bool:
	var text := "I scored %d in Dovefall. One touch. Can you beat me?" % score
	var url := Net.SHARE_URL

	if OS.has_feature("web"):
		return _share_web(img, text, url)

	# Android plugin slot: when the share plugin is installed, route through it
	# here and return true. Until then, honest fallback below.
	img.save_png(CARD_PATH)
	DisplayServer.clipboard_set("%s %s" % [text, url])
	if OS.has_feature("pc"):
		OS.shell_open(ProjectSettings.globalize_path("user://"))
	return false


## navigator.share must run inside the tap's activation window — it does: the
## whole render is two frames, well inside it. canShare({files}) gates the
## image path; browsers without it still get text + link, which is the part
## that spreads the game anyway.
static func _share_web(img: Image, text: String, url: String) -> bool:
	var b64 := Marshalls.raw_to_base64(img.save_png_to_buffer())
	var js := """
(function() {
	if (!navigator.share) return 0;
	try {
		var bin = atob('%s');
		var bytes = new Uint8Array(bin.length);
		for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
		var file = new File([bytes], 'dovefall.png', {type: 'image/png'});
		var withFile = {files: [file], text: '%s', url: '%s'};
		if (navigator.canShare && navigator.canShare({files: [file]})) {
			navigator.share(withFile).catch(function(){});
		} else {
			navigator.share({text: '%s', url: '%s'}).catch(function(){});
		}
		return 1;
	} catch (e) { return 0; }
})()
""" % [b64, text, url, text, url]
	return int(JavaScriptBridge.eval(js, true)) == 1
