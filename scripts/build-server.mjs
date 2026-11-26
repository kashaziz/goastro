// Compile the server to plain JavaScript in build/, so goastro runs from node_modules after npm install.
// (Node does not strip TypeScript types for files inside node_modules.)
import { rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
rmSync(new URL('../build', import.meta.url), { recursive: true, force: true });
execFileSync('npx', ['tsc', '-p', 'tsconfig.server.json'], { stdio: 'inherit', cwd: new URL('..', import.meta.url) });
console.log('Server compiled to build/');
