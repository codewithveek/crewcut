import { createGetDb } from "@agent-native/core/db";
import { registerShareableResource } from "@agent-native/core/sharing";

import * as schema from "./schema.js";

export const getDb = createGetDb(schema);
export { schema };

registerShareableResource({
  type: "video",
  resourceTable: schema.videos,
  sharesTable: schema.videoShares,
  displayName: "Video",
  titleColumn: "title",
  getResourcePath: (video: { id: string }) => `/videos/${video.id}`,
  agentRead: { actions: ["get-video"] },
  getDb,
});

registerShareableResource({
  type: "project",
  resourceTable: schema.projects,
  sharesTable: schema.projectShares,
  displayName: "Project",
  titleColumn: "name",
  getResourcePath: (project: { id: string }) => `/?project=${project.id}`,
  getDb,
});
