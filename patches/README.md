# Dependency patches

Applied automatically by `patch-package` via the `postinstall` script. If you
add or change a patch, edit the file under `node_modules/` and then run
`npx patch-package <package-name>` to regenerate the `.patch`.

## `@lovable.dev/mcp-js@0.20.0`

Fixes Windows-only corruption of the generated `supabase/functions/mcp/index.ts`.

The plugin bundles `src/lib/mcp/index.ts` into the edge function by feeding
esbuild a wrapper module whose entry import is an **absolute path**:

```js
import mcp from "C:\\Users\\you\\project\\src\\lib\\mcp\\index.ts";
```

Its `externalizeBareAsNpm` esbuild plugin then decides what to bundle versus
what to leave as an external `npm:` specifier:

```js
if (p.startsWith(".") || p.startsWith("/"))
  return null;                                   // local - bundle it
...
return { path: npmSpecifierFor(p, versions), external: true };  // bare - externalize
```

On POSIX the entry is `/home/...`, matches `startsWith("/")`, and gets bundled.
On Windows it is `C:\...`, matches neither guard, so it falls through and is
treated as a bare package name. The emitted function then reads:

```js
import mcp from "npm:C:\\Users\\you\\project\\src\\lib\\mcp\\index.ts";
```

That is an unresolvable specifier pointing at a local path on one developer's
machine. The whole tool bundle is missing, so the file collapses from ~191
lines to 8, and deploying it breaks the `mcp` function (`search_properties`,
`get_property`) at runtime.

The patch widens the "local path" guard to also recognise Windows drive-letter
paths (`C:\`, `C:/`) and UNC paths (`\\server\share`), so the entry is bundled
on Windows exactly as it is on POSIX.

Worth dropping upstream; if a release fixes it, delete this patch and bump the
dependency.

### Why the version is pinned exactly

`package.json` pins `@lovable.dev/mcp-js` to an exact `0.20.0`, not `^0.20.0`.

patch-package matches a patch to the installed version by the version in the
patch FILENAME. If the dependency floats - a plain `npm install`, or any tool
that re-resolves the range, such as `deno check --node-modules-dir=auto` - the
installed version moves to 0.20.1, this patch no longer matches, and it is
skipped. The build then silently regenerates the broken
`supabase/functions/mcp/index.ts` again. 0.20.1 still carries the upstream bug,
so floating buys nothing and costs the fix.

`postinstall` runs `patch-package --error-on-warn` so a skipped patch fails the
install instead of printing a warning nobody reads. Verified: with a
deliberately mismatched patch filename, the flag exits 1 where the bare command
exits 0.

To move to a newer release: change the pin, run `npm install`, then re-check
whether the guard in `dist/stacks/supabase/vite.js` and `vite.cjs` still needs
widening. If it does, edit both files under `node_modules/` and run
`npx patch-package @lovable.dev/mcp-js` to emit a patch named for the new
version, deleting the old one.
