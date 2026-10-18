# Claude Code notes

This file is a short pointer. Project context, plans and standing rules are not kept in this repository.

- **Context.** The project is tracked as guardrail G3 in `Efforts/Delivery Register.md` in the notes repository, with related notes elsewhere in that repository. The live game is https://play.gachichio.org.
- **Starting a cloud session.** Attach this repository and `bgachichio/Obsidian`, then tell Claude to read `Obsidian/CLAUDE.md` first. With only this repository attached, Claude has none of that context.
- **What a cloud session may do here.** Read, edit and test the code, commit on a `claude/*` branch, push it and open a pull request. Never push to `main`.
- **What stays local.** Deploys, servers, credentials, tokens and production data. A cloud session must not deploy, must not ask for or store a secret, and must stop and report any step that needs one.
- **House style.** UK English; dates as YYYY-MM-DD.
