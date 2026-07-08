import { auth, defineMcp } from "@lovable.dev/mcp-js";
import searchPropertiesTool from "./tools/search-properties";
import getPropertyTool from "./tools/get-property";

// Build issuer from the project ref (import.meta.env is inlined by Vite at build time,
// so this stays import-safe — no runtime env read here).
const projectRef =
  (import.meta as any).env?.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "hausto-mcp",
  title: "Hausto Property Search",
  version: "0.2.0",
  instructions:
    "Tools for Hausto — search premium rental properties in Vietnam (HCMC, Hanoi, Da Nang). Sign in with your Hausto account to connect. Use `search_properties` to find listings by city/district/budget/rooms/style, then `get_property` for full details. Always share the returned `url` (hausto.lovable.app) with the user.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [searchPropertiesTool, getPropertyTool],
});
