import { Amf0Reader, type Amf0Value } from "./amf0.js";

export interface ScriptData {
  name: string;
  value: Amf0Value;
}

const SET_DATA_FRAME = "@setDataFrame";

function readName(reader: Amf0Reader): string | undefined {
  const value = reader.read();
  return typeof value === "string" ? value : undefined;
}

/** Decodes a script tag body: an AMF0 string name followed by one value. */
export function parseScriptTag(data: Buffer): ScriptData | undefined {
  const reader = new Amf0Reader(data);
  let name = readName(reader);
  if (name === SET_DATA_FRAME) name = readName(reader);
  if (name === undefined || reader.done) return undefined;
  return { name, value: reader.read() };
}

/**
 * RTMP publishers send metadata as `@setDataFrame, onMetaData, {...}`. In an FLV file
 * the tag must start with `onMetaData`, so strip the leading `@setDataFrame` string.
 */
export function stripSetDataFrame(data: Buffer): Buffer {
  const reader = new Amf0Reader(data);
  if (readName(reader) !== SET_DATA_FRAME) return data;
  return data.subarray(reader.offset);
}

export function isMetadataObject(value: Amf0Value): value is Record<string, Amf0Value> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}
