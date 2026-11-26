# Security

goastro is a local tool. It reads and writes files on your computer, so it is built to refuse anything that does not come from you.

## How goastro protects you

- **Local only.** The server listens on `127.0.0.1`. Other computers cannot reach it.
- **A private token for each run.** goastro creates a random token when it starts and stores it in a file that only you can read (`~/.local/state/goastro/session-<port>.json`, mode 0600). The `goastro` command opens your browser with it, and the browser keeps it in an `HttpOnly`, `SameSite=Strict` cookie. Every API request needs it, so other programs and other users on the same computer cannot use goastro.
- **Links cannot act on their own.** A `?project=` link that did not come from the goastro command only asks before it opens a project.
- **Other websites cannot use it.** Every request must use goastro's own address (`127.0.0.1:<port>` or `localhost:<port>`), which stops DNS rebinding. Browser requests must come from goastro's own page, and changes must be sent as JSON, which stops cross-site requests.
- **No framing.** Other sites cannot show goastro in a frame (protection against clickjacking).
- **Project files stay in the project.** Paths are checked after symlinks are resolved, so a symlink cannot read or write outside the project. Saves go through a random, exclusive temporary file.
- **Untrusted images are sandboxed.** Images from a project, including SVG files, are served with a sandboxing Content Security Policy.
- **Safe input.** Field names such as `__proto__` are refused, request bodies are limited to 10 MB, and commands are started without a shell (except npm on Windows, with fixed arguments). Very large or deeply nested files open in Source view only, so a hostile file cannot freeze goastro.
- **Private backups.** Settings, backups and records are written with owner-only permissions.
- **Dev servers.** goastro stops only dev servers it started, and checks the process start time before it stops a leftover.

goastro does not send any data anywhere. It has no telemetry.

## What you should know

- **Preview runs project code.** **Start dev server** runs the project's `dev` script, like `npm run dev` in a terminal. Start it only for projects you trust. Opening and editing files never runs project code.
- **Remote images load.** If a post shows an image from another website, your browser loads it from there, as any Markdown editor does.

## Reporting a vulnerability

Please report security problems privately with [GitHub's private vulnerability reporting](https://github.com/kashaziz/goastro/security/advisories/new), not in a public issue. Include the steps to reproduce it. You can expect a first answer within a week.
