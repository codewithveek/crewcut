import { Container, getContainer } from "@cloudflare/containers";

interface Env {
  APP: DurableObjectNamespace<CrewcutApp>;
  [setting: string]: unknown;
}

/**
 * The whole app runs in one container (Node, Chromium for renders); this
 * Worker only routes requests to it. Every text setting (wrangler.jsonc vars
 * and `wrangler secret put` secrets) is passed to the app as an environment
 * variable. One instance, so live chat and render progress stay on one server.
 */
export class CrewcutApp extends Container<Env> {
  defaultPort = 8080;
  sleepAfter = "30m";
  enableInternet = true;

  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env);
    this.envVars = Object.fromEntries(Object.entries(env).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  }

  /** A cold start (boot, database setup) takes longer than the library's 20 s default: wait up to 3 minutes. */
  override async fetch(request: Request): Promise<Response> {
    if (!this.ctx.container?.running) {
      await this.startAndWaitForPorts({ ports: [this.defaultPort], cancellationOptions: { instanceGetTimeoutMS: 60_000, portReadyTimeoutMS: 180_000 } });
    }
    return super.fetch(request);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return getContainer(env.APP).fetch(request);
  },
} satisfies ExportedHandler<Env>;
