# companion-module-fora-mfr

Bitfocus Companion module for For.A MFR routing switchers.

See [companion/HELP.md](./companion/HELP.md) for setup and usage, and [LICENSE](./LICENSE).

## Development

Requires Node 22 and Yarn 4 (`corepack enable`).

```bash
yarn install
yarn test        # unit tests, no router needed
yarn typecheck
yarn lint
yarn package     # builds fora-mfr-<version>.tgz for loading into Companion
```

## Contributing

- Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `feat(scope): …`, `fix(scope): …`, `refactor`, `perf`, `test`, `docs`, `chore`, with `!` or a `BREAKING CHANGE:` footer for breaking changes.
- Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html): `fix` is a patch, `feat` is a minor, a breaking change is a major.
- Each release adds a section to [CHANGELOG.md](./CHANGELOG.md), grouped by commit type, and sets the same version in `package.json` and `companion/manifest.json`.
- Run `yarn test`, `yarn typecheck` and `yarn lint` before committing.
- CI runs `yarn typecheck`, `yarn lint`, `yarn test` and `yarn package` on every pull request and every push to `main`, and checks that each commit in a pull request follows Conventional Commits (Dependabot's `Bump …` commits and git's `Revert "…"` / `Reapply "…"` commits are exempt). `.github/scripts/test-check-commit-messages.sh` tests that check.

Source layout:

- `src/protocol.ts` parses router responses and builds commands
- `src/queue.ts` sends one command at a time, waiting for the router's prompt
- `src/state.ts` router names, crosspoints, locks and the operator's selection
- `src/main.ts` connects the above to Companion
- `src/actions.ts`, `feedbacks.ts`, `variables.ts`, `presets.ts` Companion definitions
