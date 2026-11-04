import { defineAction } from "@agent-native/core/action";
import { learningSchema } from "@proofcut/contracts";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";

import { getDb, schema } from "../server/db/index.js";
import { identity } from "../server/lib/identity.js";
import { getProject, listProjects } from "../server/lib/store.js";
import { newId } from "../server/lib/storage.js";

export default defineAction({
  description:
    "Save a workspace learning (hook length that works, pacing, topics, styles that held attention) that the script and motion agents read before writing. Without text, lists the project's learnings.",
  schema: z.object({
    projectId: z.string().optional(),
    scope: learningSchema.shape.scope.optional(),
    text: z.string().min(3).max(400).optional(),
    evidence: z.string().max(400).default(""),
  }),
  run: async ({ projectId, scope, text, evidence }, ctx) => {
    const who = identity(ctx);
    const project = projectId ? await getProject(projectId) : (await listProjects(ctx))[0];
    if (!project) throw new Error("No project yet.");
    const db = getDb();
    if (text && scope) {
      await db.insert(schema.learnings).values({ id: newId("lrn"), projectId: project.id, scope, text, evidence, ownerEmail: who.email, orgId: who.orgId });
    }
    const rows = await db.select().from(schema.learnings).where(eq(schema.learnings.projectId, project.id)).orderBy(desc(schema.learnings.createdAt)).limit(30);
    return { projectId: project.id, learnings: rows.map((row) => ({ scope: row.scope, text: row.text, evidence: row.evidence, createdAt: row.createdAt })) };
  },
});
