import { registerRoot } from "remotion";

import { loadCrewcutFonts } from "./fonts";
import { RemotionRoot } from "./remotion-root";

void loadCrewcutFonts();
registerRoot(RemotionRoot);
