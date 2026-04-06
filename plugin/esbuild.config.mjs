import esbuild from "esbuild";
import builtins from "builtin-modules";
import process from "node:process";

const isWatch = process.argv.includes("--watch");

const ctx = await esbuild.context({
  entryPoints: ["main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtins,
  ],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: isWatch ? "inline" : false,
  treeShaking: true,
  outfile: "main.js",
});

if (isWatch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
