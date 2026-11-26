# goastro.dev

The landing page for goastro: one static HTML page with images. No build step.

Preview locally:

```bash
npx serve site
```

Deploy to Cloudflare Pages (after the GitHub repository is public):

```bash
npx wrangler pages deploy site --project-name=goastro
```

Then attach the custom domain `goastro.dev` to the Pages project in the Cloudflare dashboard.
If you change an inline <script> in index.html, update its sha256 hash in _headers (there are two scripts).
