import { Layer } from "effect";
import { Claims } from "./claims.ts";
import { Feed } from "./feed.ts";
import { Inbox } from "./inbox.ts";
import { MainRegistry } from "./main-registry.ts";
import { Presence } from "./presence.ts";
import { Throttle } from "./throttle.ts";

const stores = Layer.mergeAll(
  Presence.layer,
  Inbox.layer,
  Feed.layer,
  Throttle.layer,
  MainRegistry.layer,
);

export const MeshServices = Claims.layer.pipe(Layer.provideMerge(stores));
