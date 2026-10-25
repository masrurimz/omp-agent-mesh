import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";
import messenger from "pi-messenger";
import { formatBrief } from "./brief.ts";
import { isMainSession, mainOnly, type GateContext } from "./gate.ts";
import type { Peer } from "./peer.ts";
import { Registry } from "./registry.ts";
import { makeRuntime } from "./runtime.ts";

interface HostLogger {
  readonly warn?: (message: string) => void;
}

export default function (pi: ExtensionAPI) {
  messenger(mainOnly(pi));

  const host = pi as unknown as { logger?: HostLogger };
  const runtime = makeRuntime(({ logLevel, message }) => {
    if (logLevel === "Warn" || logLevel === "Error") {
      host.logger?.warn?.(`mesh: ${String(message)}`);
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (!isMainSession(ctx as GateContext)) {
      pi.setActiveTools(pi.getActiveTools().filter((name) => name !== "pi_messenger"));
      return;
    }
    const peers = await runtime.runPromise(
      Registry.use((registry) => registry.activePeers(process.pid)).pipe(
        Effect.catchTag("RegistryReadError", () => Effect.succeed<ReadonlyArray<Peer>>([])),
      ),
    );
    if (peers.length > 0) {
      pi.sendMessage(
        { customType: "mesh-brief", content: formatBrief(peers), display: false },
        { deliverAs: "nextTurn" },
      );
    }
  });
}
