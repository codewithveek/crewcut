import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

/** Crewcut's logo in share emails (a PNG on our domain, set by APP_LOGO_URL). */
const emailLogoUrl = () => process.env.APP_LOGO_URL || undefined;

registerShareableResource({
  type: "video",
  resourceTable: schema.videos,
  sharesTable: schema.videoShares,
  displayName: "Video",
  titleColumn: "title",
  getResourcePath: (video: { id: string }) => `/videos/${video.id}`,
  agentRead: { actions: ["get-video"] },
  getLogoUrl: emailLogoUrl,
  getDb,
});

registerShareableResource({
  type: "project",
  resourceTable: schema.projects,
  sharesTable: schema.projectShares,
  displayName: "Project",
  titleColumn: "name",
  getResourcePath: (project: { id: string }) => `/?project=${project.id}`,
  getLogoUrl: emailLogoUrl,
  getDb,
});
