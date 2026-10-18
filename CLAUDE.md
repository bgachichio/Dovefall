# Claude Code notes

This file is a short pointer. Project context, plans and standing rules are not kept in this repository.

- **Context.** The project is tracked as guardrail G3 in `Efforts/Delivery Register.md` in the notes repository, with related notes elsewhere in that repository. The live game is https://play.gachichio.org.
- **Starting a cloud session.** Attach this repository and `bgachichio/Obsidian`, then tell Claude to read `Obsidian/CLAUDE.md` first. With only this repository attached, Claude has none of that context.
- **In a cloud session:** read, edit and test the code, commit on a `claude/*` branch, push it and open a pull request. Never push to `main`. (Local work on the laptop is unaffected by this file.)
- **Deploys and secrets stay local.** A cloud session never deploys and never prints, stores or commits a secret. When it changes deployable code it appends an entry to `Efforts/Deploy Queue.md` in the notes repository (so attach it) and says so in its last message; the owner deploys from the laptop using this project's `DEPLOY.md`.
- **House style.** UK English; dates as YYYY-MM-DD.
