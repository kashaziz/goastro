# Other Markdown folders

goastro is built for Astro, and Astro projects get automatic setup. Any other folder with `.md` or `.mdx` files also opens, for example a Docusaurus, Hugo, Jekyll or Eleventy site, or a `docs/` folder in any repository.

## What goastro detects

goastro looks for these folders: `content/`, `docs/`, `posts/`, `_posts/`, `blog/`, `articles/`, `notes/`, `pages/`, `src/content/` and `src/posts/`. Each one with Markdown files becomes a content folder. If none exists, goastro uses the whole folder.

The home page shows these projects with a **Markdown** badge.

## Check the settings once

Open **Project settings** and check:

- the **content folders**,
- the **Page URL pattern** for each folder,
- the **Dev server address** of your framework, for example `http://localhost:3000` for Docusaurus or `http://localhost:1313` for Hugo.

## Preview

goastro can start the dev server only if `package.json` has a `dev` script. For other tools, such as Hugo or Jekyll, start the dev server yourself and click **Reload** in Preview.

## What works the same

Visual editing, protected blocks, the metadata form, the review diff and backups work exactly as they do for Astro projects.
