import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/main.ts'],
  clean: true,
  dts: true,
  sourcemap: true,
  format: ['esm'],
  esbuildOptions(options) {
    options.mangleProps = /[^_]_$/;
  },
});
