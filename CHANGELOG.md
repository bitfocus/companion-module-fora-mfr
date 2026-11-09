# Changelog

All notable changes to this module are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), the version numbers follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html), and entries are grouped by the
[Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) type of the change.

## [3.0.0] - 2026-11-09

### ⚠ BREAKING CHANGES

- Runs on Companion's Node 26 runtime (`node26` in the manifest), like other modules built on the API 2.1 template. Development needs Node 26.
- Port options and the `xpt##`, `selected_dst_id`, `selected_dst_src_id`, `selected_dst_preset_src_id`, `selected_src_id` and `active_selected_id` variables use the port number shown in the list (`11`), not a zero-based hex id (`0A`). Saved dropdown choices are converted automatically. An expression or button text that relies on the old hex values must be changed by hand.

### Bug Fixes

- **fix(config):** an empty, fractional or out-of-range MFR Port now shows "Bad configuration" instead of crashing the module on every restart. The field only accepts whole numbers.
- **fix(names):** the port names page refuses an Apply that the module cannot queue in full, asking for smaller batches, instead of reporting every name as sent and leaving the router half renamed.
- **fix(polling):** the refresh runs at the interval set. A value that is not a multiple of 5 seconds no longer runs at the next multiple of 5.
- **fix(actions):** a destination or source option in expression mode takes the port number shown in the list. `11` used to be read as a zero-based hex id, which sent it to port 18.
- **fix(actions):** **Lock/Unlock a destination** hides its Destination option while "Use the selected destination" is ticked. That checkbox, and "Apply straight away" of **Preset video format**, can no longer be switched to an expression.

### Performance

- **perf(routing):** a burst of route actions queues one re-read of the routes, not one per action.
- **perf(names):** a source rename updates the routed-name variables of only the destinations using that source.

### Build System

- **build:** follow the API 2.1 template: `.gitattributes` keeps LF line endings, husky and lint-staged format and lint staged files before each commit, Prettier no longer skips two GitHub files, and the template's Node CI and release workflows are added. Publishing a GitHub release attaches the module package.

## [2.0.0] - 2026-11-04

A rewrite in TypeScript for Companion 5, built against and tested on Companion 5.1.1. Earlier versions of Companion have
not been tested, and the only router it has been tested with is an MFR-3000. The ids of v1's actions, feedbacks and connection settings are unchanged
and there is no upgrade script, but upgrading a v1 configuration has not been tested. Check your buttons after upgrading.

### ⚠ BREAKING CHANGES

- Requires Companion 5 (module API `@companion-module/base` 2.x) and Node 22.20 or newer. It no longer loads in Companion 3 or 4. Stay on 1.0.x for those.
- Selecting a destination no longer clears the selected source, and the selection no longer blinks all the time: only the next source flashes, while it differs from what is routed. A destination and a source can be selected in either order and both stay highlighted until the next cut or salvo, so buttons that relied on the old blink need no change but will look steady.
- The host is no longer pre-filled with a default address.
- Presets are rebuilt under new ids with a new look (layered buttons with the same plain text version as a fallback). Buttons already placed from v1 presets are unaffected, because Companion copies a preset when it is placed.
- The three video format presets are gone. See "Removed" below.

### Features

- **feat(routing):** staged routes (`P:`) are read back from the router (`V?`). New **Staged destination** and **Staged source** feedbacks, the `selected_dst_preset_src_id` / `_name` variables, and the `xpt##_pending_name` variable show what is staged before it is taken.
- **feat(routing):** routes waiting for a take are called _staged_ throughout, on buttons and in action and feedback names, so they can't be confused with Companion's button presets. The ids of the actions and feedbacks and the names of the variables are unchanged.
- **feat(routing):** new **Clear staged crosspoint(s)** action (`B:C`) to discard staged routes.
- **feat(routing):** new **Stage a route** and **Cut a route** actions that take an explicit destination and source instead of using the selection.
- **feat(routing):** new connection setting "When a destination and a source are both selected": wait for the button (default), cut straight away, or stage straight away. Staging keeps the pair on show, so a salvo is built by picking a source and tapping destinations, then taken with **Switch staged crosspoint(s)**. Cutting a destination removes it from the staged routes, so a later take cannot undo the cut. A cut to a locked destination logs a warning and keeps the selection and staged route.
- **feat(routing):** new **Set auto-route mode** action, **Auto-route mode** feedback, `auto_route_mode` variable and a preset that steps off, stage, cut. The mode is saved in the connection settings. Changing a setting other than the host, port or refresh interval no longer reconnects.
- **feat(routing):** a selected source flashes while it would change the selected destination's route, so the next source can be told from the current one at a glance. The new **Staged routes waiting** feedback flashes the salvo preset while routes are staged. Neither reads the router, and the timer runs only while something is flashing.
- **feat(presets):** destination and source presets light up for as long as they are held, using Companion's own pushed feedback, so a press shows even when auto-route cuts and clears the selection straight away.
- **feat(names):** a table of port names at `/instance/<connection label>/`. Edit or paste many names, then Apply them together. It shows what the router kept, and can copy all names and refill the previous ones.
- **feat(log):** logs what was found on connecting, reconnects, the auto-route mode, bulk renames, and routes and names changed from elsewhere. At debug level it also logs operator commands, commands with no prompt, and lines it doesn't recognise.
- **feat(recording):** supports Companion's action recording. Stage or cut routes while recording and they are captured as **Stage a route** / **Cut a route** actions, ready to replay from one button.
- **feat(names):** port names are re-read at every refresh, so a name changed on the router's panel or web interface appears in Companion.
- **feat(routing):** routes and staged routes are re-read from the router every 5 seconds (connection setting, 0 turns it off) and straight after each routing command, so route changes made from the web UI or a panel appear on buttons. Staged routes are per connection on the router, so only this module's own are shown.
- **feat(lock):** the lock action can toggle lock / unlock and can act on the selected destination. The lock preset shows `LOCK` or `UNLOCK` with the destination name, driven by the new `selected_dst_lock_action` and `selected_dst_lock_text` variables.
- **feat(video):** the default video format, reference and switching point are set in the connection settings and shown by the `video_format_default` variable. The **Preset video format** action can use them ("Use the connection default") and can apply straight away. The module never changes the router's format by itself.
- **feat(presets):** presets use Companion 5 layered buttons with a plain text fallback: a blank button in the module style, destination and source buttons, cut and stage buttons laid out as source / `v` / destination, and a destination button that shows its routed source and, only while a route is staged, the staged source.
- **feat(variables):** new `xpt##_name` (routed source name per destination), `selected_src_label` and `selected_dst_label` (names, or `SRC` / `DST` while nothing is selected).

### Bug Fixes

- **fix(protocol):** commands are sent one at a time and wait for the router's prompt, and so for all of a long reply, as its protocol requires. If no prompt arrives the module moves on after the manual's timeouts: 1 second, or 5 seconds for commands with long replies. Operator actions go ahead of the startup reads. v1 did not wait and could overrun the router.
- **fix(protocol):** the video format replies (`UF!`, `UR!`) are logged, and `UR!E` is a warning that the router rejected the change.
- **fix(protocol):** names are sent as upper case hex of UTF-8, as the manual specifies, and decoded the same way. After a rename the module reads the name back and shows what the router stored, warning if it differs: the MFR tested kept 16 characters and dropped non-ASCII ones. The system size request uses the manual's `@ F?<Lvl>` form.
- **fix(protocol):** incoming data is framed per line across packets. The receive buffer was shared between instances, started with 32 NUL bytes and survived reconnects; it is now per connection and reset on connect.
- **fix(protocol):** responses are parsed by one typed parser instead of substring checks, and a router that replies on the same line as the echo is handled.
- **fix(lock):** lock status was requested before the router size was known on a first connection, so no locks were read. It is now requested once the size is known.
- **fix(select):** the crosspoint lookup used when selecting a destination had an off-by-one.
- **fix(select):** choosing a port outside the router's size, cutting without both ends selected, or locking before the unit ID is known now logs a warning instead of sending a malformed command or throwing.
- **fix(actions):** the default text for the rename actions is `New name` (it was an object), and the lock feedback treats any non-zero lock mode as locked.
- **fix(connection):** a lost network is noticed within about 11 seconds, by treating 6 seconds without a reply to a command as a lost connection, instead of waiting for TCP to give up. The return of the network is noticed within about 5 seconds, by starting a fresh attempt every 5 seconds. The link is still tested every 5 seconds when the refresh is off or slower.
- **fix(ui):** the periodic refresh no longer makes buttons flash. Unchanged routes, locks and staged routes are ignored, and the staged list is replaced once, when the reply is complete.
- **fix(lifecycle):** timers are cleared on destroy and on a new connection. v1's blink timer leaked; the blink is gone.

### Performance Improvements

- **perf(presets):** the button image no longer carries its leftover camera and editor metadata, more than halving the size of the presets and of buttons exported from them. The picture is unchanged.
- **perf(definitions):** port names and sizes now rebuild dropdowns, variables and presets once per batch (debounced) instead of on every received line, and presets are no longer rebuilt from a file read each time. Duplicate variable definitions are gone.
- **perf(ui):** dropdowns list every port as soon as the router's size is known, labelled `n: name`.

### Refactoring

- **refactor:** rewritten in TypeScript on `@companion-module/base` 2.x, split into `protocol`, `queue`, `state`, `actions`, `feedbacks`, `variables` and `presets` modules around a thin `main.ts`. The button image is embedded in the code.
- **refactor(build):** Yarn 4, `@companion-module/tools` 3.x, ESLint 10, Prettier, TypeScript 6.

### Tests

- **test:** `yarn fake-router` runs the tests' fake router on its own, so the module can be tried in Companion without hardware.
- **test:** unit tests for the protocol parser, the command queue, the router state, the presets, and the module against a simulated router using the framing captured from a real MFR (no router needed).

### Documentation

- **docs:** `HELP.md` rewritten: setup, how selection and salvos work, recording a macro, variables, actions, feedbacks and presets. `README.md` describes development and the source layout.

### Continuous Integration

- **ci:** GitHub Actions run `yarn typecheck`, `yarn lint`, `yarn test` and `yarn package` on each pull request and each push to `main`, and check that each commit in a pull request follows Conventional Commits (Dependabot's `Bump …` commits and git's `Revert` / `Reapply` commits are exempt). The commit message check has its own tests, run in CI.

### Removed

- **Video format presets** (preset, apply and cancel). The router restarts when a new format is accepted and cannot report its current format, so a button could not show or confirm anything and a stray press is costly. The Preset, Apply and Cancel video format **actions** remain.
- The `src/main.js` single-file implementation, `build-config.cjs` and `.prettierrc`.

### Not yet supported

- "Lock others" mode (needs a multi-router system), re-initialising a unit (`Z:`), and reading back the video format (the router cannot report it).
- Only the lowest crosspoint level that answers is controlled.

## [1.0.2] - 2025-01-12

### Bug Fixes

- Improved decoding of source and destination names from the hex values returned by the MFR. This fixes the module for Companion 3.4.x.

### Documentation

- Updated the label text for "Preset Crosspoint" and "Switch Crosspoint" actions for clarity.

### Chores

- Moved the button image to an `images/` directory.
- Upgraded module-base and module-tools.

[3.0.0]: https://github.com/bitfocus/companion-module-fora-mfr/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/bitfocus/companion-module-fora-mfr/compare/v1.0.2...v2.0.0
[1.0.2]: https://github.com/bitfocus/companion-module-fora-mfr/releases/tag/v1.0.2
