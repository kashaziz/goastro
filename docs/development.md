# Development

```bash
git clone https://github.com/kashaziz/goastro.git
cd goastro
npm install
npm run build
npm link          # use your local copy as the goastro command
```

| Command | What it does |
|---|---|
| `npm test` | Round-trip, frontmatter, dev server, settings and security tests (uses the real editor in jsdom). |
| `npm run build` | Type-check, build the web app into `dist/`, and compile the server into `build/`. |
| `npm run dev:web` | Vite dev server for the interface (run `npm start` too). |
| `npm start` | Run goastro from source without opening the browser. |
| `npm run verify -- <project>` | Read-only round-trip check of a real project. |

In the repository, `bin/goastro.js` runs the TypeScript source directly (Node 22.18+ strips the types). An installed package runs the compiled `build/` instead, because Node does not strip types inside `node_modules`.

## Main files

| File | Purpose |
|---|---|
| `server/core/markdown.ts` | Block split, editor conversion, round-trip check, safe save. |
| `server/core/frontmatter.ts` | Minimal-diff YAML editing. |
| `server/core/document.ts` | Loads a file into the editor model and composes the saved text. |
| `server/core/project.ts` | Project detection, settings, project search, file listing, path checks. |
| `server/core/devserver.ts` | Dev servers for Preview, and their cleanup. |
| `server/core/paths.ts` | Config, state and backup folders. |
| `server/index.ts` | HTTP API and static files, with the request guard. |
| `server/cli.ts` | The `goastro` command. |
| `shared/extensions.ts` | The editor schema, shared by the browser and the tests. |
| `web/src/` | The React and TipTap interface. |
| `test/fixtures/` | MDX and Markdown files with real-world shapes and lorem ipsum text. |
| `examples/demo-blog/` | A small demo project. |
| `site/` | The goastro.dev landing page. |

## Pull requests

Please run `npm test` and `npm run build` before you open a pull request. For a bug in saving, add a fixture to `test/fixtures/` that shows it.
