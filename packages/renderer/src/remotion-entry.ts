import { registerRoot } from "remotion";

import { loadProofcutFonts } from "./fonts";
import { RemotionRoot } from "./remotion-root";

void loadProofcutFonts();
registerRoot(RemotionRoot);
