// Regenerate public/courses/index.json (the in-game course list) from the baked course files.
//   npx tsx scripts/catalog.ts
// Place names and the look (links or parkland) come from pipeline/courses/catalog-meta.json; files listed in SKIP are inputs
// or development data, not playable catalog entries.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { CourseData } from "../src/mapcourse/types";

const DIR = "public/courses";
const SKIP = new Set(["index.json", "romanby-h2.json", "sample-course.json"]);
const meta: Record<string, { name?: string; place?: string; country?: string; style?: "links" | "parkland" }> = JSON.parse(
  readFileSync("pipeline/courses/catalog-meta.json", "utf8"),
);

const entries = readdirSync(DIR)
  .filter((f) => f.endsWith(".json") && !SKIP.has(f))
  .map((file) => {
    const id = file.replace(/\.json$/, "");
    const c: CourseData = JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
    return {
      id,
      file: `courses/${file}`,
      name: meta[id]?.name ?? c.name,
      place: meta[id]?.place ?? "",
      country: meta[id]?.country ?? "",
      // Greenside Classic look: "parkland" (tree-lined) or "links" (open, seaside).
      style: meta[id]?.style ?? "parkland",
      holes: c.holes.length,
      par: c.holes.reduce((a, h) => a + h.par, 0),
      yards: c.holes.reduce((a, h) => a + h.lengthYards, 0),
      photorealHoles: c.splat ? (c.splat.holes ?? c.holes.map((h) => h.number)) : [],
      credits: c.attribution,
    };
  })
  .sort((a, b) => a.name.localeCompare(b.name));
const json = JSON.stringify({ courses: entries }, null, 1);
writeFileSync(`${DIR}/index.json`, json);
// The game bundles the list from here (Vite serves public/ as-is and won't let code import it).
writeFileSync("src/mapcourse/catalog.json", json);
for (const e of entries) console.log(`${e.id}: ${e.name} · ${e.holes} holes · par ${e.par} · ${e.yards} yds${e.photorealHoles.length ? ` · photoreal ${e.photorealHoles.join(",")}` : ""}`);
