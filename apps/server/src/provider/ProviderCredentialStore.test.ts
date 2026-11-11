import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as ProviderCredentialStore from "./ProviderCredentialStore.ts";

it.effect("isolates provider bindings and preserves opaque credentials", () =>
  Effect.gen(function* () {
    const data = new Map<string, Uint8Array>();
    const secretStore = ServerSecretStore.ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromUndefinedOr(data.get(name))),
      set: (name, value) =>
        Effect.sync(() => {
          data.set(name, value);
        }),
      remove: (name) =>
        Effect.sync(() => {
          data.delete(name);
        }),
      create: () => Effect.die("unused"),
      getOrCreateRandom: () => Effect.die("unused"),
    });
    const a = yield* ProviderCredentialStore.make("cursor", "../../personal").pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    const b = yield* ProviderCredentialStore.make("cursor", "work").pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    const c = yield* ProviderCredentialStore.make("other", "../../personal").pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    const bytes = Uint8Array.from([0, 255, 128, 1]);
    yield* a.set(bytes);
    assert.deepStrictEqual(Option.getOrThrow(yield* a.get), bytes);
    assert.isTrue(Option.isNone(yield* b.get));
    assert.isTrue(Option.isNone(yield* c.get));
    assert.isFalse(a.binding.key.includes("/"));
    // Stored credentials are found by this name, so it must not change between releases.
    assert.strictEqual(
      a.binding.key,
      "provider-auth-db3cc9436c8272847fe0c152ba8b0d4695af90acd916f555649e17ba6efe6094",
    );
    const long = yield* ProviderCredentialStore.make("a".repeat(64), "b".repeat(64)).pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    assert.isBelow(long.binding.key.length, 255);
    const delimiter = yield* ProviderCredentialStore.make("cur", "sor../../personal").pipe(
      Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore),
    );
    assert.notStrictEqual(delimiter.binding.key, a.binding.key);
    yield* a.remove;
    assert.isTrue(Option.isNone(yield* a.get));
  }).pipe(Effect.provide(NodeCrypto.layer)),
);

it.effect("revoking account A's credential leaves account B intact and denies A's future use", () =>
  Effect.gen(function* () {
    const data = new Map<string, Uint8Array>();
    const secretStore = ServerSecretStore.ServerSecretStore.of({
      get: (name) => Effect.sync(() => Option.fromUndefinedOr(data.get(name))),
      set: (name, value) =>
        Effect.sync(() => {
          data.set(name, value);
        }),
      remove: (name) =>
        Effect.sync(() => {
          data.delete(name);
        }),
      create: () => Effect.die("unused"),
      getOrCreateRandom: () => Effect.die("unused"),
    });
    const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      effect.pipe(Effect.provideService(ServerSecretStore.ServerSecretStore, secretStore));
    const a = yield* provide(ProviderCredentialStore.make("cursor", "personal"));
    const b = yield* provide(ProviderCredentialStore.make("cursor", "work"));
    const bytesA = Uint8Array.from([1, 2, 3]);
    const bytesB = Uint8Array.from([9, 8, 7]);
    yield* provide(a.set(bytesA));
    yield* provide(b.set(bytesB));
    // Distinct bindings for the same driver: revoking one must not touch the other.
    assert.notStrictEqual(a.binding.key, b.binding.key);
    yield* provide(a.remove);
    // A's future use is denied: the credential is gone and stays gone across reads.
    assert.isTrue(Option.isNone(yield* provide(a.get)));
    assert.isTrue(Option.isNone(yield* provide(a.get)));
    // B's binding and stored credential survive A's revocation untouched.
    assert.deepStrictEqual(Option.getOrThrow(yield* provide(b.get)), bytesB);
    // Removing B still works independently afterwards.
    yield* provide(b.remove);
    assert.isTrue(Option.isNone(yield* provide(b.get)));
  }).pipe(Effect.provide(NodeCrypto.layer)),
);
