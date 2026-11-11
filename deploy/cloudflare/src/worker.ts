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

  /**
   * Once a day (see "triggers" in wrangler.jsonc): wake the app. The container
   * sleeps when nobody visits, and jobs that must run on a schedule only run
   * while it's awake: the 30-day YouTube authorisation check and the deletion
   * of revoked accounts' data that the Privacy Policy promises, closing
   * interrupted exports, and telling the operator about data requests.
   */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      getContainer(env.APP)
        .fetch(new Request("https://crewcut.internal/api/health"))
        .then((response) => console.log(`[cron] app woken: ${response.status}`))
        .catch((error: unknown) => console.error("[cron] could not wake the app:", error)),
    );
  },
} satisfies ExportedHandler<Env>;
