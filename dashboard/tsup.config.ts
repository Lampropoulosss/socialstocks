import { defineConfig } from 'tsup';

export default defineConfig({
    entry: ['src/server/index.ts'],
    outDir: 'dist',
    format: ['esm'],
    target: 'es2020',
    clean: false, // Don't clean dist immediately as vite builds client there too? No, vite builds to dist/client usually or similar.
    sourcemap: true,
    splitting: false,
});
