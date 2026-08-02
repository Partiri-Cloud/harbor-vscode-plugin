import esbuild from 'esbuild';

const watch = process.argv.includes('--watch');
// .vscodeignore excludes *.map, so a published build must not emit the
// //# sourceMappingURL comment that would point at a file not in the VSIX.
const sourcemap = !process.argv.includes('--no-sourcemap');

/** @type {esbuild.BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap,
  minify: false,
  logLevel: 'info',
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild watching for changes...');
} else {
  await esbuild.build(options);
}
