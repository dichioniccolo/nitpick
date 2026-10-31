import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

/** Values read once at start: the public URL and the App's handle for `@` mentions. */
export class Settings extends Context.Service<
  Settings,
  { readonly appUrl: string; readonly appSlug: string }
>()("@nitpick/review/Settings") {
  static readonly layer = Layer.effect(
    Settings,
    Effect.gen(function* () {
      const appUrl = yield* Config.String("APP_URL");
      const appSlug = yield* Config.String("GITHUB_APP_SLUG");

      return { appUrl, appSlug };
    }),
  );
}
