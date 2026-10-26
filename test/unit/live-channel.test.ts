import { beforeEach, describe, expect, it } from "vitest";
import { CloseCode } from "../../src/shared/close-codes.js";
import { FlvStreamParser } from "../../src/server/flv/reader.js";
import type { FlvTag } from "../../src/server/flv/types.js";
import { LiveChannel, type ViewerConnection } from "../../src/server/delivery/live-channel.js";
import { createLogger } from "../../src/server/logger.js";
import { interframe, keyframe, metadataTag, sequenceHeader } from "../helpers/tags.js";

class FakeViewer implements ViewerConnection {
  static next = 0;
  readonly id = `v${FakeViewer.next++}`;
  bufferedAmount = 0;
  closed: { code: number; reason: string } | undefined;
  dropped = 0;
  private parser = new FlvStreamParser();
  tags: FlvTag[] = [];

  send(data: Buffer): void {
    this.tags.push(...this.parser.push(data));
  }

  close(code: number, reason: string): void {
    this.closed = { code, reason };
  }

  noteDropped(): void {
    this.dropped++;
  }
}

const logger = createLogger({ name: "test", level: "silent" });
const options = { maxGopBytes: 1e6, softBufferBytes: 1000, hardBufferBytes: 5000, maxCongestionMs: 3000 };

describe("LiveChannel", () => {
  let now = 0;
  let channel: LiveChannel;
  beforeEach(() => {
    now = 0;
    channel = new LiveChannel("m30t-01", options, logger, () => now);
  });

  function goLive(session = "s1"): void {
    channel.publish(session);
    channel.metadata(session, metadataTag());
    channel.videoTag(session, sequenceHeader());
    channel.videoTag(session, keyframe(0));
    channel.videoTag(session, interframe(33));
  }

  it("streams header, metadata, sequence header and cached GOP to a viewer joining a live stream", () => {
    goLive();
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    expect(viewer.tags).toEqual([metadataTag(), sequenceHeader(), keyframe(0), interframe(33)]);
    channel.videoTag("s1", interframe(66));
    expect(viewer.tags.at(-1)).toEqual(interframe(66));
  });

  it("keeps a viewer that joins while offline waiting and starts it at the first keyframe", () => {
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    expect(viewer.tags).toEqual([]);
    expect(viewer.closed).toBeUndefined();

    channel.publish("s1");
    channel.metadata("s1", metadataTag());
    channel.videoTag("s1", sequenceHeader());
    expect(viewer.tags).toEqual([]);
    channel.videoTag("s1", keyframe(0));
    channel.videoTag("s1", interframe(33));
    // Exactly one copy of the keyframe.
    expect(viewer.tags).toEqual([metadataTag(), sequenceHeader(), keyframe(0), interframe(33)]);
  });

  it("closes streaming viewers with 4000 when the publisher leaves, but keeps waiting viewers", () => {
    goLive();
    const streaming = new FakeViewer();
    channel.addViewer(streaming);
    channel.unpublish("s1");
    const waiting = new FakeViewer();
    channel.addViewer(waiting);
    expect(streaming.closed?.code).toBe(CloseCode.DroneOffline);
    expect(streaming.closed?.reason).toBe("drone-offline");
    expect(waiting.closed).toBeUndefined();
    expect(channel.live).toBe(false);
    expect(channel.viewerCount).toBe(1);
  });

  it("sends 4001 when the sequence header changes and restarts later viewers with the new one", () => {
    goLive();
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    channel.videoTag("s1", sequenceHeader(7, 4000));
    expect(viewer.closed?.code).toBe(CloseCode.StreamReset);

    const next = new FakeViewer();
    channel.addViewer(next);
    expect(next.tags).toEqual([]); // GOP was cleared, wait for the next keyframe
    channel.videoTag("s1", keyframe(4000));
    expect(next.tags).toEqual([metadataTag(), sequenceHeader(7, 4000), keyframe(4000)]);
  });

  it("keeps viewers when the same sequence header comes before every keyframe (real RC Plus)", () => {
    goLive();
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    channel.videoTag("s1", sequenceHeader(0, 1000));
    channel.videoTag("s1", keyframe(1000));
    channel.videoTag("s1", interframe(1033));
    expect(viewer.closed).toBeUndefined();
    expect(viewer.tags.slice(-2)).toEqual([keyframe(1000), interframe(1033)]);

    const next = new FakeViewer();
    channel.addViewer(next);
    expect(next.tags).toEqual([metadataTag(), sequenceHeader(0, 1000), keyframe(1000), interframe(1033)]);
  });

  it("replaces a live publisher with 4001 and ignores the old session afterwards", () => {
    goLive("old");
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    channel.publish("new");
    expect(viewer.closed?.code).toBe(CloseCode.StreamReset);
    expect(channel.sessionId).toBe("new");

    channel.videoTag("old", keyframe(99)); // late data from the replaced publisher
    channel.unpublish("old");
    expect(channel.live).toBe(true);
    expect(channel.stats().gopTags).toBe(0);
  });

  it("drops frames for a congested viewer until the next keyframe, without affecting others", () => {
    goLive();
    const slow = new FakeViewer();
    const fast = new FakeViewer();
    channel.addViewer(slow);
    channel.addViewer(fast);
    const before = slow.tags.length;

    slow.bufferedAmount = 2000; // above soft limit
    channel.videoTag("s1", interframe(66));
    slow.bufferedAmount = 0; // drained, but still mid-GOP
    channel.videoTag("s1", interframe(99));
    expect(slow.tags.length).toBe(before);
    channel.videoTag("s1", keyframe(2000));
    channel.videoTag("s1", interframe(2033));
    expect(slow.tags.slice(before)).toEqual([keyframe(2000), interframe(2033)]);
    expect(fast.tags.slice(before)).toEqual([
      interframe(66),
      interframe(99),
      keyframe(2000),
      interframe(2033),
    ]);
    // Reported to the connection too (connection quality on the admin page).
    expect([slow.dropped, fast.dropped]).toEqual([2, 0]);
  });

  it("reports stream resets with their reason", () => {
    const resets: string[] = [];
    channel = new LiveChannel(
      "m30t-01",
      options,
      logger,
      () => now,
      undefined,
      (reason) => resets.push(reason),
    );
    goLive("old");
    channel.videoTag("old", sequenceHeader(7, 4000));
    channel.publish("new");
    expect(resets).toEqual(["camera", "publisher"]);
  });

  it("does not count the start snapshot as congestion, so a late joiner keeps its frames", () => {
    channel.publish("s1");
    channel.videoTag("s1", sequenceHeader());
    channel.videoTag("s1", keyframe(0, 3000)); // GOP snapshot larger than the soft limit
    const viewer = new FakeViewer();
    channel.addViewer(viewer);
    const before = viewer.tags.length;

    viewer.bufferedAmount = 3500; // snapshot still draining
    channel.videoTag("s1", interframe(33));
    viewer.bufferedAmount = 1500; // drained below snapshot + soft limit
    channel.videoTag("s1", interframe(66));
    expect(viewer.tags.slice(before)).toEqual([interframe(33), interframe(66)]);
    expect(channel.stats().droppedTags).toBe(0);

    // Once drained below the soft limit, the normal limits apply again.
    viewer.bufferedAmount = 500;
    channel.videoTag("s1", interframe(99));
    viewer.bufferedAmount = 1500;
    channel.videoTag("s1", interframe(133));
    expect(viewer.tags.at(-1)).toEqual(interframe(99));
    expect(channel.stats().droppedTags).toBe(1);
  });

  it("gives a keyframes viewer each keyframe and its follower only, from snapshot and live", () => {
    goLive();
    channel.videoTag("s1", interframe(66));
    const saver = new FakeViewer();
    const full = new FakeViewer();
    channel.addViewer(saver, "keyframes");
    channel.addViewer(full);
    expect(saver.tags).toEqual([metadataTag(), sequenceHeader(), keyframe(0), interframe(33)]);

    channel.videoTag("s1", interframe(99));
    channel.metadata("s1", metadataTag()); // metadata always passes
    channel.videoTag("s1", keyframe(2000));
    channel.videoTag("s1", interframe(2033));
    channel.videoTag("s1", interframe(2066));
    expect(saver.tags.slice(4)).toEqual([metadataTag(), keyframe(2000), interframe(2033)]);
    expect(full.tags.slice(5)).toEqual([
      interframe(99),
      metadataTag(),
      keyframe(2000),
      interframe(2033),
      interframe(2066),
    ]);
    expect(channel.stats().keyframeViewers).toBe(1);
  });

  it("starts a waiting keyframes viewer at the next keyframe and sends its follower", () => {
    const saver = new FakeViewer();
    channel.addViewer(saver, "keyframes");
    channel.publish("s1");
    channel.videoTag("s1", sequenceHeader());
    channel.videoTag("s1", interframe(-33)); // before the first keyframe: no GOP yet
    channel.videoTag("s1", keyframe(0));
    channel.videoTag("s1", interframe(33));
    channel.videoTag("s1", interframe(66));
    expect(saver.tags).toEqual([sequenceHeader(), keyframe(0), interframe(33)]);
  });

  it("closes a viewer with 4008 above the hard limit or after staying congested too long", () => {
    goLive();
    const huge = new FakeViewer();
    const lingering = new FakeViewer();
    channel.addViewer(huge);
    channel.addViewer(lingering);
    huge.bufferedAmount = 6000;
    lingering.bufferedAmount = 2000;
    channel.videoTag("s1", interframe(66));
    expect(huge.closed?.code).toBe(CloseCode.ViewerTooSlow);
    expect(lingering.closed).toBeUndefined();
    now = 3500;
    channel.videoTag("s1", interframe(99));
    expect(lingering.closed?.code).toBe(CloseCode.ViewerTooSlow);
    expect(channel.viewerCount).toBe(0);
    expect(channel.stats().slowViewerClosures).toBe(2);
  });
});
