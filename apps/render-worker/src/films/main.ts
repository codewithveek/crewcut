import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";

import { type Composition, normalizeComposition, parseComposition } from "@crewcut/composition";

import { demoFilm } from "./demo";
import { autopilotLaunchFilm } from "./autopilot-launch";
import { hackathonFilm } from "./hackathon";
import { launchFilm } from "./launch";

/**
 * Crewcut's own films, built as ordinary compositions:
 *   pnpm --filter @crewcut/render-worker films --film launch --source <scratch>/rec --out storage/films
 * Writes <out>/<film>.json; render it with `pnpm render --input <file>` or composition-stills.
 */
async function main(): Promise<void> {
  const { values } = parseArgs({ options: { film: { type: "string", default: "launch" }, source: { type: "string" }, out: { type: "string", default: "storage/films" } } });
  if (!values.source) throw new Error("Pass --source <dir with take1/ take2/ and ../audio/vo.json>");
  const films: Record<string, (source: string) => unknown> = { launch: launchFilm, demo: demoFilm, hackathon: hackathonFilm, "autopilot-launch": autopilotLaunchFilm, "autopilot-demo": (source: string) => hackathonFilm(source, "demo") };
  const build = films[values.film!];
  if (!build) throw new Error(`Unknown film ${values.film}`);
  const composition: Composition = normalizeComposition(parseComposition(build(values.source)));
  const out = path.resolve(values.out!);
  await mkdir(out, { recursive: true });
  const file = path.join(out, `${values.film}.json`);
  await writeFile(file, JSON.stringify(composition));
  const visual = composition.tracks.flatMap((track) => (track.kind === "visual" ? track.clips : []));
  console.log(`${values.film}: ${(composition.durationMs / 1000).toFixed(1)} s, ${visual.length} clips → ${file}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? (error.stack ?? error.message) : error);
  process.exitCode = 1;
});
