import { assertEquals } from "jsr:@std/assert";
import { archiveInstagramRadarImage } from "./instagramRadarImage.ts";

Deno.test("archives an official Instagram thumbnail and returns only the stable storage URL", async () => {
  const uploaded: Array<{ path: string; contentType: string; upsert: boolean }> = [];
  const stableUrl = "https://project.supabase.co/storage/v1/object/public/ap-images/radar/instagram/image.jpg";
  const result = await archiveInstagramRadarImage({
    storage: {
      from: () => ({
        upload: async (path, _body, options) => {
          uploaded.push({ path, contentType: options.contentType, upsert: options.upsert });
          return { error: null };
        },
        getPublicUrl: () => ({ data: { publicUrl: stableUrl } }),
      }),
    },
    clienteId: "tenant-a",
    sourceId: "source-a",
    externalId: "media-a",
    thumbnailUrl: "https://scontent.cdninstagram.com/thumbnail.jpg",
    fetchImpl: async () => new Response(
      new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
      { headers: { "content-type": "image/jpeg" } },
    ),
    resolveDns: async () => ["1.1.1.1"],
  });
  assertEquals(result, stableUrl);
  assertEquals(uploaded.length, 1);
  assertEquals(uploaded[0].contentType, "image/jpeg");
  assertEquals(uploaded[0].upsert, true);
  assertEquals(uploaded[0].path.startsWith("radar/instagram/tenant-a/source-a/"), true);
});

Deno.test("rejects a public but non-Meta thumbnail origin before fetching", async () => {
  let fetched = false;
  const result = await archiveInstagramRadarImage({
    storage: { from: () => { throw new Error("must not upload"); } },
    clienteId: "tenant-a",
    sourceId: "source-a",
    externalId: "media-a",
    thumbnailUrl: "https://8.8.8.8/thumbnail.jpg",
    fetchImpl: async () => {
      fetched = true;
      throw new Error("must not fetch");
    },
  });
  assertEquals(result, null);
  assertEquals(fetched, false);
});

Deno.test("does not upload when Graph did not provide a thumbnail", async () => {
  let called = false;
  const result = await archiveInstagramRadarImage({
    storage: { from: () => { called = true; throw new Error("must not upload"); } },
    clienteId: "tenant-a",
    sourceId: "source-a",
    externalId: "media-a",
    thumbnailUrl: null,
  });
  assertEquals(result, null);
  assertEquals(called, false);
});
