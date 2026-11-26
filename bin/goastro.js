#!/usr/bin/env node
// goastro [project] [--port N] [--no-open]  |  goastro stop
// In the repository, run the TypeScript source directly. In an installed package, run the compiled build.
import { existsSync } from 'node:fs';
const source = new URL('../server/cli.ts', import.meta.url);
const cli = existsSync(source) ? await import(source.href) : await import(new URL('../build/server/cli.js', import.meta.url).href);
await cli.main();
