# How goastro keeps MDX safe

Many visual editors convert a whole file into their own format and write it back out. That round trip quietly changes things: component props get reformatted, an HTML table turns into something else, a comment disappears. goastro does not trust itself to rewrite anything it does not fully understand.

## The rules

1. **Blocks.** goastro splits each file into top-level blocks: paragraphs, headings, lists, quotes, components, imports and so on.
2. **Round-trip check.** A block is editable visually only if it converts to the editor and back to exactly the same syntax tree. Otherwise it becomes a **protected block**, shown as locked source.
3. **Byte-for-byte copies.** When you save, every block you did not change is copied from the original file, byte for byte. Only the blocks you edited are written again.
4. **Inline MDX stays put.** A `<Badge />`, `{year}` or `{/* comment */}` inside a sentence appears as a small chip. The text around it stays editable.
5. **Frontmatter edits are surgical.** Only the values you change are replaced. Comments, key order and quote style stay.
6. **Audit before save.** goastro compares the old and new file. If protected content is removed or changed, or the new file does not parse as MDX or Markdown, it warns you, and you must confirm.
7. **No lost work.** goastro refuses to save if the file changed on disk after you opened it. It copies the old file to a backup folder before each save, and it writes through a temporary file so a crash never leaves half a file.
8. **Line endings and BOM** are kept: CRLF files stay CRLF.

## What is protected

`import` and `export` lines, JSX components, HTML blocks, `{expressions}`, comments, GFM tables, code blocks, task lists, footnotes, and some rare nesting such as `[**bold link**](/x)`.

## Limitations

- **Protected blocks are not visual.** A component with Markdown inside (for example `<Callout>**text**</Callout>`) is one protected block. Edit it with **Edit source** or in Source view.
- **Tables are protected.** Edit GFM and HTML tables as source.
- **Edited blocks use one Markdown style.** When you change a block, it is written with `-` bullets (or the list's original marker), `*emphasis*`, `**bold**` and `##` headings. Unchanged blocks keep their style.
- **Entities are decoded in edited blocks.** For example `&amp;` becomes `&` in a block you change. The page looks the same.
- **Component props are not form fields.** Change `<ProductPick name="…" />` attributes in source.
- **Schema rules are not checked.** goastro does not read the validation in `content.config.ts`. A wrong value can still fail your Astro build.
- **Images are paths only.** goastro does not upload or copy image files. Images imported in MDX (`import img from './a.png'`) stay as protected source.
- **Very large or very deeply nested files** (over about 200 KB, or nested more than 40 levels) open in Source view only, so they cannot slow goastro down.
- **Files that MDX cannot parse** open in Source view only. Example: an HTML comment `<!-- -->` in an `.mdx` file.

## Check a project before you edit

From a clone of the goastro repository you can run a read-only check:

```bash
npm run verify -- my-blog
```

For every content file, it simulates opening and saving with no edits, then with one paragraph edit. It reports any file that would change unexpectedly.
