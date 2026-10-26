import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isToolCallEventType } from "@earendil-works/pi-coding-agent";

import { applyCommandPolicy } from "../../scripts/vcs-command-policy.ts";

export default function vcsPolicy(pi: ExtensionAPI) {
  pi.on("tool_call", (event) => {
    if (isToolCallEventType("bash", event)) {
      const result = applyCommandPolicy(event.input.command);

      if (result.action === "block") {
        return { block: true, reason: result.reason };
      }

      event.input.command = result.command;
    }

    return {};
  });
}
