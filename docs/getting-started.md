# Getting started

## Requirements

- Node.js 22.18 or later.
- An Astro project, or any folder with `.md` or `.mdx` files.
- A modern browser (Chrome, Edge, Firefox or Safari).

## Install

```bash
npm install --global goastro
```

This installs the `goastro` command. If you use nvm, install it again after you switch to another Node version.

## Open your first project

Go to your Astro project and run `goastro`:

```bash
cd ~/work/my-astro-site
goastro
```

goastro starts a small local server and opens your browser with the project loaded. It also works from a subfolder, such as `src/content`.

The browser opens through a private link that signs this browser in to goastro for this run. Other programs and other users on your computer cannot use goastro. If you open `http://127.0.0.1:4545` yourself, or goastro has restarted, run `goastro` again to get a fresh tab.

If goastro is already running, the command only opens a new browser tab. You never get two copies.

Other ways to open a project:

| Command | What it does |
|---|---|
| `goastro my-blog` | Finds `my-blog` in your [project folders](projects-and-settings.md#project-folders) and opens it. |
| `goastro ~/path/to/site` | Opens a project by path. |
| `goastro` outside an Astro project | Opens the current folder if it has Markdown files ([other Markdown folders](other-markdown-folders.md)). Otherwise it opens the [home page](projects-and-settings.md#the-home-page), where you choose a project. |

## Edit and save a post

1. Click a post in the list on the left.
2. Edit the text. Open **Metadata** to change the title, date, tags and other frontmatter.
3. Click **Review & save**, or press Ctrl+S.
4. Read the diff. Click **Save to file**.

More in [Writing and saving](writing-and-saving.md).

## Stop goastro

Press Ctrl+C in the terminal where goastro runs, or run this in any terminal:

```bash
goastro stop
```

This also stops every dev server that goastro started for Preview.

## Options

| Option | Meaning |
|---|---|
| `--port <n>` | Use another port for goastro (default 4545). |
| `--no-open` | Do not open the browser. goastro prints the private link instead. |
| `--help` | Show help. |

## Try the demo

The repository has a small demo blog with MDX components, a table and images:

```bash
git clone https://github.com/kashaziz/goastro.git
cd goastro
goastro examples/demo-blog
```

Edit freely. Nothing in it is real.
