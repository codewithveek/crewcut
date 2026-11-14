import { defineAction } from "@agent-native/core/action";
import { THUMBNAIL_POSITIONS, THUMBNAIL_STYLES, thumbnailMaxMs } from "@crewcut/composition";
import { z } from "zod";

import { UserError } from "../server/lib/errors.js";
import { nowIso } from "../server/lib/json.js";
import { MAX_THUMBNAILS, MAX_TITLES, packagingHistory, readPackaging, savePackaging, scorePackaging } from "../server/lib/packaging.js";
import { newId } from "../server/lib/storage.js";
import { latestComposition, loadVideo } from "../server/lib/store.js";

const thumbnailFields = {
  atMs: z.number().min(0).describe("The moment of the video behind the headline (ms)"),
  headline: z.string().max(60).describe("A few words, ideally ≤5; wrap words in *stars* to colour them; empty = picture only"),
  style: z.enum(THUMBNAIL_STYLES).describe("bold: big white words with an outline · boxed: words on an accent box · outline: accent words, black outline · minimal: smaller, clean"),
  position: z.enum(THUMBNAIL_POSITIONS),
  logo: z.boolean().describe("Keep the brand logo if the video has one"),
};

export default defineAction({
  description:
    "Thumbnail & title lab: add, change, remove or choose a video's title and thumbnail options. addTitles: up to 12 titles (≤100 characters; say the angle in `why`). addThumbnails: up to 8 thumbnails, each a moment of the video (atMs) with a short headline in a style and position. updateThumbnail changes one; remove takes ids out; chooseTitle / chooseThumbnail pick what publishing uses (null clears). Returns the options scored against the channel's click-through history. Give real variety (different angles, moments and styles), not small rewordings.",
  schema: z.object({
    videoId: z.string(),
    addTitles: z.array(z.object({ text: z.string().trim().min(1).max(100), why: z.string().max(300).optional() })).max(MAX_TITLES).optional(),
    addThumbnails: z.array(z.object({ ...thumbnailFields, headline: thumbnailFields.headline.default(""), style: thumbnailFields.style.default("bold"), position: thumbnailFields.position.default("bottom"), logo: thumbnailFields.logo.default(true) })).max(MAX_THUMBNAILS).optional(),
    updateThumbnail: z
      .object({
        id: z.string(),
        atMs: thumbnailFields.atMs.optional(),
        headline: thumbnailFields.headline.optional(),
        style: thumbnailFields.style.optional(),
        position: thumbnailFields.position.optional(),
        logo: thumbnailFields.logo.optional(),
      })
      .optional(),
    remove: z.array(z.string()).max(20).optional(),
    chooseTitle: z.string().nullable().optional(),
    chooseThumbnail: z.string().nullable().optional(),
  }),
  run: async (args, ctx) => {
    const video = await loadVideo(args.videoId, ctx, "editor");
    const author = video.who.kind === "human" ? "person" : "crew";
    const packaging = await readPackaging(args.videoId);
    const current = await latestComposition(args.videoId);
    const maxMs = current ? thumbnailMaxMs(current.composition) : Number.POSITIVE_INFINITY;

    if (args.remove?.length) {
      const gone = new Set(args.remove);
      packaging.titles = packaging.titles.filter((title) => !gone.has(title.id));
      packaging.thumbnails = packaging.thumbnails.filter((thumbnail) => !gone.has(thumbnail.id));
      if (packaging.chosenTitleId && gone.has(packaging.chosenTitleId)) delete packaging.chosenTitleId;
      if (packaging.chosenThumbnailId && gone.has(packaging.chosenThumbnailId)) delete packaging.chosenThumbnailId;
    }
    for (const title of args.addTitles ?? []) {
      // The same words again would only crowd the list.
      if (packaging.titles.some((existing) => existing.text.toLowerCase() === title.text.toLowerCase())) continue;
      packaging.titles.push({ id: newId("ttl"), text: title.text, why: title.why ?? "", author, createdAt: nowIso() });
    }
    if (packaging.titles.length > MAX_TITLES) throw new UserError(`A video keeps up to ${MAX_TITLES} title options. Remove some first.`);
    for (const thumbnail of args.addThumbnails ?? []) {
      packaging.thumbnails.push({ id: newId("thm"), ...thumbnail, atMs: Math.min(Math.round(thumbnail.atMs), maxMs), author, createdAt: nowIso() });
    }
    if (packaging.thumbnails.length > MAX_THUMBNAILS) throw new UserError(`A video keeps up to ${MAX_THUMBNAILS} thumbnail options. Remove some first.`);
    if (args.updateThumbnail) {
      const { id, ...patch } = args.updateThumbnail;
      const target = packaging.thumbnails.find((thumbnail) => thumbnail.id === id);
      if (!target) throw new UserError(`No thumbnail option "${id}".`);
      Object.assign(target, Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)));
      if (typeof patch.atMs === "number") target.atMs = Math.min(Math.round(patch.atMs), maxMs);
    }
    if (args.chooseTitle !== undefined) {
      if (args.chooseTitle === null) delete packaging.chosenTitleId;
      else if (packaging.titles.some((title) => title.id === args.chooseTitle)) packaging.chosenTitleId = args.chooseTitle;
      else throw new UserError(`No title option "${args.chooseTitle}".`);
    }
    if (args.chooseThumbnail !== undefined) {
      if (args.chooseThumbnail === null) delete packaging.chosenThumbnailId;
      else if (packaging.thumbnails.some((thumbnail) => thumbnail.id === args.chooseThumbnail)) packaging.chosenThumbnailId = args.chooseThumbnail;
      else throw new UserError(`No thumbnail option "${args.chooseThumbnail}".`);
    }
    await savePackaging(video.row, packaging);
    const owner = video.who.email === video.row.ownerEmail;
    return scorePackaging(packaging, owner ? await packagingHistory(video.row.ownerEmail, args.videoId) : []);
  },
});
