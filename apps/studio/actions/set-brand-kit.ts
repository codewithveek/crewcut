import { defineAction } from "@agent-native/core/action";
import { BRAND_COLOR_ROLES, BRAND_LOGO_PLACEMENTS, FONT_FAMILIES, brandKitSchema } from "@crewcut/composition";
import { z } from "zod";

import { checkLogo, readBrandKit, saveBrandKit } from "../server/lib/brand.js";
import { workspaceOf } from "../server/lib/catalog.js";
import { UserError } from "../server/lib/errors.js";
import { identity } from "../server/lib/identity.js";

const color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use #rrggbb")
  .nullable();

export default defineAction({
  description:
    "Change the workspace's brand kit. Pass only what changes; null clears a colour, a font or the logo. colors: background, surface, ink (main text), muted (secondary text), accent, accent2 as #rrggbb. fonts: display (headlines) and body. logo: an image asset id from the media library (upload or import it first) with placement, sizePct (logo height, % of the short side) and opacity. autoApply: templates / drafts (use the colours and fonts on new template videos / the crew's drafts) and logo (add the logo to them too). Only set what the person asked for. Applies to new videos; use apply-brand-kit for an existing one.",
  schema: z.object({
    colors: z.object(Object.fromEntries(BRAND_COLOR_ROLES.map((role) => [role, color.optional()])) as Record<(typeof BRAND_COLOR_ROLES)[number], z.ZodOptional<typeof color>>).optional(),
    fonts: z.object({ display: z.enum(FONT_FAMILIES).nullable().optional(), body: z.enum(FONT_FAMILIES).nullable().optional() }).optional(),
    logo: z
      .object({
        assetId: z.string().min(1).max(64).optional(),
        placement: z.enum(BRAND_LOGO_PLACEMENTS).optional(),
        sizePct: z.number().min(4).max(30).optional(),
        opacity: z.number().min(0.2).max(1).optional(),
      })
      .nullable()
      .optional(),
    autoApply: z.object({ templates: z.boolean().optional(), drafts: z.boolean().optional(), logo: z.boolean().optional() }).optional(),
  }),
  run: async (args, ctx) => {
    const who = identity(ctx);
    const workspace = workspaceOf({ email: who.email, orgId: who.orgId });
    const kit = await readBrandKit(workspace);
    const colors: Record<string, string | undefined> = { ...kit.colors };
    for (const [role, value] of Object.entries(args.colors ?? {})) {
      if (value === undefined) continue;
      colors[role] = value === null ? undefined : value.toLowerCase();
    }
    const fonts: Record<string, string | undefined> = { ...kit.fonts };
    for (const [role, value] of Object.entries(args.fonts ?? {})) {
      if (value === undefined) continue;
      fonts[role] = value === null ? undefined : value;
    }
    let logo = kit.logo;
    if (args.logo === null) logo = undefined;
    else if (args.logo) {
      const assetId = args.logo.assetId ?? logo?.assetId;
      if (!assetId) throw new UserError("Pick a logo picture first.");
      // A new picture: check it's theirs and measure its shape.
      const measured = !logo || assetId !== logo.assetId ? await checkLogo(assetId, who) : null;
      logo = {
        assetId,
        aspect: measured?.aspect ?? logo?.aspect ?? 1,
        placement: args.logo.placement ?? logo?.placement ?? "top-right",
        sizePct: args.logo.sizePct ?? logo?.sizePct ?? 10,
        opacity: args.logo.opacity ?? logo?.opacity ?? 0.9,
      };
    }
    const next = brandKitSchema.parse({
      colors: Object.fromEntries(Object.entries(colors).filter(([, value]) => value)),
      fonts: Object.fromEntries(Object.entries(fonts).filter(([, value]) => value)),
      ...(logo ? { logo } : {}),
      autoApply: { ...kit.autoApply, ...Object.fromEntries(Object.entries(args.autoApply ?? {}).filter(([, value]) => value !== undefined)) },
    });
    await saveBrandKit(workspace, next, who.actorId);
    return { kit: next, note: "Saved. New template videos and drafts use it as set in autoApply; call apply-brand-kit to restyle an existing video." };
  },
});
