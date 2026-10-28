# Media Traffic

A web demonstration for uploading a fixed-camera traffic video, following cars
with YOLO, and reviewing candidate red-light crossings with synchronized evidence.
The repository currently implements video upload/playback, immutable scene
configuration, an optional backend YOLO/ByteTrack tracking adapter, and playback-
synchronized car overlays. Signal inference and crossing decisions remain
separate implementation/acceptance tasks.

## Product workflow

1. Prepare a synthetic traffic video with independently annotated reference events.
2. Upload and preview the video.
3. Configure the vehicle region, stop line, crossing direction, and governing signal.
4. Track cars, read signal states, and identify candidate crossings during red.
5. Review the evidence and record a separate human decision.

The first demonstration uses a fixed camera and one movement. Unknown signal
states or insufficient trajectories remain indeterminate. Source annotations must
never be substituted for inference. Live cameras, plate recognition, fines,
multi-camera support, and public deployment are outside this initial scope.

`../media-ads` is a read-only reference for upload, asynchronous jobs, playback,
FFmpeg processing, and detection panels. Its one-frame-per-second sampling and
track summaries must not be assumed sufficient for traffic crossing analysis.

## Specifications and backlog

- [Linear project](https://linear.app/matias-personal/project/media-traffic-c8f955049a38/overview)
- [GitHub repository](https://github.com/matiasbinagora/media-traffic)
- [OpenSpec change](openspec/changes/traffic-red-light-demo/proposal.md)
- [Technical design](openspec/changes/traffic-red-light-demo/design.md)
- [Implementation tasks](openspec/changes/traffic-red-light-demo/tasks.md)
- [Story template](docs/user-story-template.md)
- [Story-to-issue backlog map](docs/backlog.md)

Write stories, specifications, project documentation, and future interface copy
in English. OpenSpec records requirements and scenarios; Linear records ownership,
dependencies, progress, and evidence. Keep real issue identifiers and spec paths
linked in both systems. Unchecked implementation tasks are not completed work.

## Local tooling

```sh
nvm use
npm ci
npm run agents:doctor
npm run spec:validate
```

Node is pinned in `.nvmrc`. The repository pins agents-cli 0.4.2, OpenSpec 1.13.2,
and TestSprite 0.15.0 through `devDependencies` and `package-lock.json`. Use npm
scripts or the direnv-provided PATH to select local tools instead of global CLIs.
The tooling manifest pins repository utilities; optional model runtime and
weights are not bundled with the application.

| Command | Purpose |
| --- | --- |
| `npm run agents -- --help` | Manage the configured agent suite |
| `npm run agents:doctor` | Inspect local agent configuration; not a live connectivity test |
| `npm run spec -- list --specs` | List current specifications |
| `npm run spec -- status --change traffic-red-light-demo` | Inspect planning artifact completion |
| `npm run spec:validate` | Strictly validate all changes and specifications |
| `npm run testsprite -- --help` | Use the local TestSprite CLI |
| `npm run test:auth` | Verify TestSprite authentication |
| `npm run test:e2e` | Run tests for the exported `TESTSPRITE_PROJECT_ID` |

The local application implements video upload, playback derivative, immutable
scene configuration, and a real YOLO/ByteTrack backend adapter. Start
`npm run server` and `npm run dev` in separate terminals for local development.
FFmpeg and FFprobe must be installed. See
[`docs/video-upload-api.md`](docs/video-upload-api.md) for API states, limits,
failure behavior, and timestamp/coordinate mappings. OpenSpec validation checks
specification structure; it does not evaluate traffic detection quality.
See [`docs/scene-configuration-api.md`](docs/scene-configuration-api.md) for the
analysis-run contract, observation and gap schema, inference setup, and licensing
gate.

| Command | Purpose |
| --- | --- |
| `npm run server` | Start the local Node API on `127.0.0.1:8787` |
| `npm run dev` | Start Vite; `/api` requests proxy to the local API |
| `npm run build` | Type-check the frontend and build production assets |
| `npm run typecheck:server` | Strictly type-check backend TypeScript |
| `npm run typecheck:frontend` | Strictly type-check frontend TypeScript |
| `npm run test:backend` | Test upload, analysis-run API, retained tracks/gaps, FFmpeg derivative, and playback |
| `npm run test:frontend` | Run frontend component tests with Vitest |
| `npm test` | Run backend and frontend suites |

Uploads and analysis-run JSON are stored under the ignored `.local-data/`
directory by default. The configured size cap defaults to 200 MiB; there is no
duration limit. Upload and preview success are separate from traffic analysis.

The optional tracker requires operator-supplied Python with OpenCV, PyTorch,
PyYAML, and Ultralytics plus the qualified `yolo26n.pt` checkpoint. Configure
`YOLO_PYTHON_PATH` and `YOLO_MODEL_PATH`; the adapter verifies the checkpoint
hash and records runtime/tracker/sampling provenance. The user selected GNU
AGPL-3.0 for this public prototype; see [`LICENSE`](LICENSE). That scope does not
clear broader commercial or production use. Ultralytics weights and Python
runtime dependencies are not bundled; review
[`docs/scene-configuration-api.md`](docs/scene-configuration-api.md) for the
third-party runtime and model license scope. No weights or Python runtime
dependencies are committed.

## Repository-local GitHub authentication

`.envrc` sets `GH_CONFIG_DIR` to `.direnv/gh`, selects this GitHub repository, removes
inherited `GH_TOKEN`/`GITHUB_TOKEN`, and adds `node_modules/.bin` to PATH. Direnv
restores the previous environment when leaving the directory. `.direnv/` is ignored.

If needed, enable direnv in your shell with `eval "$(direnv hook zsh)"` in `~/.zshrc`.
Then activate and authenticate from the repository root:

```sh
direnv allow
gh auth login --hostname github.com --git-protocol https --web --insecure-storage
chmod 600 "$GH_CONFIG_DIR/hosts.yml"
gh api user --jq .login
```

`--insecure-storage` keeps the token as plaintext in the ignored local directory
instead of the shared system keychain. Do not share `.direnv/`. The configuration
directory is private (`700`); token permissions still depend on GitHub grants and
are not restricted to this repository merely by selecting `GH_REPO`.

The initial documentation and tooling baseline is published from `main`. For
each Linear story, create a focused branch in a repository-local worktree under
`.worktrees/<story-slug>`. Link its Linear issue and OpenSpec requirements in
the pull request, record the checks and evidence, and request both independent
technical review and QA review before the user reviews the PR. Do not merge or
mark the story Done without the required authorization and gates.

GitHub MCP connection state under `.agents/mcp-state-codex.json` is local and
must not be committed. The generated lockfile may record its local file hash;
keep the state file excluded and do not edit generated ownership metadata by
hand.

## Integrations and agent roles

The five Codex roles under `.codex/agents/` use the `m-traffic` prefix.
`agents-cli.config.json` records the suite. Do not manually alter generated agent
or MCP files without accounting for ownership hashes in `.agents-cli.lock.json`.

Linear OAuth is configured through `agents-cli-linear`. If authorization expires,
run `codex mcp login agents-cli-linear`, then verify a project read. The project
belongs to the Personal team (`PER`). GitHub operations use `gh`; the optional
GitHub MCP separately requires `GITHUB_TOKEN`. JEV requires `TYPESAFE_API_KEY`
and has not been live-verified. Start the runtime with direnv active so the JEV
command resolves the local agents-cli.

## TestSprite and acceptance

TestSprite authentication, V3 routing, and local tunnel access were verified.
No TestSprite project or functional suite has been created yet. After an application
exists, select or create the correct project and seed a broad suite across upload,
configuration, processing, failures, result inspection, and reviewer decisions.

Export `TESTSPRITE_PROJECT_ID`; start the application separately before local runs:

```sh
npm run test:e2e -- --local 3000 --local-host 127.0.0.1
```

Adjust the port to the implemented server. Use `--env staging` only after creating
that environment. Keep run IDs and artifacts, and inspect failures before reporting.
TestSprite validates user workflows; deterministic rule tests and actual inference
against independent annotations evaluate traffic analysis. Agree accuracy targets
and timing tolerances before final acceptance. Configure a CI gate only once an
executable environment exists and verify it on a real pull request.

Never commit credentials or uploads. Npm scripts require exported environment
variables and do not load `.env` automatically.
