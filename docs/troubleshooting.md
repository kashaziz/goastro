# Troubleshooting

## "port 4545 is used by another program"

goastro names the program and its process ID. Stop that program, or use another port:

```bash
goastro --port 4546
```

To change the default port, open **Settings** on the home page.

## "an older version of the editor runs on port …"

An older goastro is still running. Stop it:

```bash
goastro stop
```

## "Open goastro from your terminal"

goastro answers only the browser tab that its own command opened. You see this page when you open `http://127.0.0.1:4545` yourself, or after goastro restarts. Run `goastro` in your terminal to open a fresh tab.

## "A link asks to open …"

A link with `?project=` that did not come from the goastro command, for example from a web page, never opens a project by itself. Click **Open project** only if you expected it.

## How do I stop goastro?

Press Ctrl+C in its terminal, or run `goastro stop` in any terminal. For goastro on another port: `goastro stop --port 4546`.

## The goastro command is not found

- Check that Node.js 22.18 or later is installed: `node --version`.
- With nvm, global packages belong to one Node version. Run `npm install --global @goastro/goastro` again after you switch versions.

## Preview says "refused to connect" or stays empty

- Click **Reload**. A brand-new dev server can need a moment.
- Check the address shown above the preview. Fix the **Page URL pattern** or the **Dev server address** in Project settings if it is wrong.
- If the dev server stopped, goastro shows its last output below the buttons.

See [Preview and dev servers](preview-and-dev-servers.md).

## "The file changed on disk after you opened it"

Another program changed the file. goastro refuses to save so it cannot overwrite that change. Copy your text, reload the file, and apply your edit again.

## "This change removes protected content"

Your edit deletes or changes a protected block, such as a component or an HTML table. Read the diff. If the change is what you want, tick the box and save. Otherwise click **Keep editing**.

## A post opens in Source view only

The file has syntax that the MDX parser cannot read, for example an HTML comment `<!-- -->` in an `.mdx` file. Fix it in Source view, or in your code editor.

## A field shows the wrong input, or a field is missing

Open **Project settings**, choose the content folder, and change the field type, or add the field. **Re-detect** rebuilds the settings from your posts.

## My projects do not appear on the home page

Add the folder where you keep them in **Settings → Project folders**. goastro looks two levels deep. Check that you did not remove the card with **×**: **Settings → Hidden projects → Show them again**.

## Where are the backups?

In `~/.local/state/goastro/backups/<project>/<time>/`, with the same folder structure as your project.

## Native Windows (outside WSL)

Native Windows is not tested yet. If something does not work, please [open an issue](https://github.com/kashaziz/goastro/issues). WSL is tested and works.
