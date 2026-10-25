/** Custom WebSocket close codes shared by server and web client (CLAUDE.md §4). */
export const CloseCode = {
  /** Publisher disconnected. Client shows "Kein Signal" and reconnects. */
  DroneOffline: 4000,
  /** Sequence header changed or publisher replaced. Client recreates the player immediately. */
  StreamReset: 4001,
  /** An admin paused this device (ADR 0012). Client shows "Übertragung angehalten", no reconnect. */
  Paused: 4003,
  UnknownDrone: 4004,
  /** Backpressure limit reached. */
  ViewerTooSlow: 4008,
} as const;
export type CloseCode = (typeof CloseCode)[keyof typeof CloseCode];

export const CloseReason: Record<CloseCode, string> = {
  [CloseCode.DroneOffline]: "drone-offline",
  [CloseCode.StreamReset]: "stream-reset",
  [CloseCode.Paused]: "paused",
  [CloseCode.UnknownDrone]: "unknown-drone",
  [CloseCode.ViewerTooSlow]: "viewer-too-slow",
};
