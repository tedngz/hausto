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
