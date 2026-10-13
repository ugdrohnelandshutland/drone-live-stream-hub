// Type declarations for the protocol layer of node-media-server 4.4.x, which ships plain JS.
// Only the members used by NmsIngestAdapter are declared.
declare module "node-media-server/src/protocol/rtmp.js" {
  interface NmsConnectRequest {
    app: string;
    name: string;
    host: string;
    query: Record<string, unknown>;
  }

  interface NmsAvPacket {
    /** RTMP message type: 8 audio, 9 video, 18 AMF0 data, 15 AMF3 data. */
    codec_type: number;
    codec_id: number;
    flags: number;
    pts: number;
    dts: number;
    size: number;
    /** Reused parser buffer; only the first `size` bytes are valid. */
    data: Buffer;
  }

  class Rtmp {
    /** The connect command object as received (set when `connect` arrives). */
    connectCmdObj?: Record<string, unknown>;
    onConnectCallback: (req: NmsConnectRequest) => void;
    onPlayCallback: () => void;
    onPushCallback: () => void;
    onOutputCallback: (buffer: Buffer) => void;
    onPacketCallback: (packet: NmsAvPacket) => void;
    /** Returns an error string, or null on success. May throw on malformed input. */
    parserData(buffer: Buffer): string | null;
  }

  export = Rtmp;
}
