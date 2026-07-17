// @ts-check
import { defineConfig } from 'astro/config';
import vue from '@astrojs/vue';

// https://astro.build/config
export default defineConfig({
	output: 'static',
	integrations: [vue()],
	vite: {
		build: {
			// Three.js lives in a lazy scene chunk (about 537 kB raw / 134 kB gzip).
			chunkSizeWarningLimit: 550,
		},
	},
});
