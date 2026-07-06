import { defineMcp } from "@lovable.dev/mcp-js";
import searchPropertiesTool from "./tools/search-properties";
import getPropertyTool from "./tools/get-property";

export default defineMcp({
  name: "hausto-mcp",
  title: "Hausto Property Search",
  version: "0.1.0",
  instructions:
    "Tools for Hausto — search premium rental properties in Vietnam (HCMC, Hanoi, Da Nang). Use `search_properties` to find listings by city/district/budget/rooms/style, then `get_property` for full details. Always share the returned `url` (hausto.lovable.app) with the user.",
  tools: [searchPropertiesTool, getPropertyTool],
});
