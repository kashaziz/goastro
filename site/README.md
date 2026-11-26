# goastro.dev

The landing page for goastro: static HTML, fonts and images. No build step.
It is served by Cloudflare Workers static assets, configured in `../wrangler.jsonc`
(custom domain goastro.dev).

Preview locally:

```bash
npx serve site
```

Deploy (from the repository root):

```bash
npx wrangler deploy
```

Notes:

- `_headers` sets the security headers. If you change an inline `<script>` in index.html
  or privacy-disclaimer/index.html, update its sha256 hash in `_headers` (there are two scripts).
- `.assetsignore` keeps this README from being published.
- `404.html` is shown for unknown addresses.
