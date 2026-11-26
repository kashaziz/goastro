// Demo project for goastro. Run `goastro examples/demo-blog` from the goastro folder.
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';

export default defineConfig({ integrations: [mdx()] });
