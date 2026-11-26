# Preview and dev servers

Preview shows the real page from your Astro dev server, inside goastro.

## How it works

1. Open a post and click **Preview**.
2. If a dev server already runs at the project's dev server address (default `http://localhost:4321`), goastro uses it.
3. If not, click **Start dev server**. goastro runs `npm run dev -- --port <free port>` in the project folder, waits until the page answers, and shows it.

Preview always shows the **saved** file. Astro reloads the page after each save.

goastro can start a dev server only if your `package.json` has a `dev` script. Otherwise, start the dev server yourself and click **Reload**.

**Start dev server runs the project's own code** (its `dev` script and its Astro configuration), just as `npm run dev` does in a terminal. Only start it for projects you trust. Editing files never runs project code.

## Cleanup: no forgotten dev servers

goastro stops the dev servers that **it** started:

- when you stop goastro (Ctrl+C, `goastro stop`, closing the terminal, or a crash),
- when you open another project,
- when no goastro tab has been open for 3 minutes (each open tab tells goastro it is there every 30 seconds; this costs almost nothing),
- when Preview has not been used for the idle time (30 minutes by default, see [settings](projects-and-settings.md#goastro-settings)),
- when you click **Stop dev server**.

Details:

- Each dev server runs in its own process group. A stop also ends Astro's child processes (on Windows, `taskkill /T`).
- goastro records each dev server in `~/.local/state/goastro/dev-servers.json`, with its owner and start time. If goastro is killed with `kill -9`, the next start stops the leftovers. A reused process ID is never stopped, and dev servers of another running goastro are left alone.
- goastro **never** stops a dev server that you started yourself.
- goastro runs at most **one** dev server at a time. Running `goastro` again does not start a second goastro; it opens a new tab to the running one.

Closing the browser does not stop goastro itself. It keeps running, uses little memory, and opens at once the next time you run `goastro`. Run `goastro stop` to end it.

## WSL (Windows Subsystem for Linux)

goastro works well in WSL with a Windows browser. A new dev server inside WSL can take a moment before Windows can reach it, so goastro waits until the browser can load the page. You see "Waiting for the page to answer…" for a second or two.

## If Preview stays empty

- Check the address under the Preview buttons. If it is wrong, fix the **Page URL pattern** or **Dev server address** in [Project settings](projects-and-settings.md#project-settings).
- If the dev server stopped, goastro shows its last output. Fix the error in your project, then click **Start dev server** again.
- Click **Reload**.

More in [Troubleshooting](troubleshooting.md).
