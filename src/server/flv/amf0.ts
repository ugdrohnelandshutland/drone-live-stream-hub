/** Minimal AMF0 decoder for FLV script data (onMetaData). */

export type Amf0Value =
  number | boolean | string | null | undefined | Date | Amf0Value[] | { [key: string]: Amf0Value };

export class Amf0Error extends Error {
  override readonly name = "Amf0Error";
}

const MAX_DEPTH = 16;

export class Amf0Reader {
  offset = 0;
  constructor(private readonly data: Buffer) {}

  get done(): boolean {
    return this.offset >= this.data.length;
  }

  private ensure(n: number): void {
    if (this.offset + n > this.data.length) throw new Amf0Error("AMF0 data truncated");
  }

  private readUtf8(lengthBytes: 2 | 4): string {
    this.ensure(lengthBytes);
    const length =
      lengthBytes === 2 ? this.data.readUInt16BE(this.offset) : this.data.readUInt32BE(this.offset);
    this.offset += lengthBytes;
    this.ensure(length);
    const value = this.data.toString("utf8", this.offset, this.offset + length);
    this.offset += length;
    return value;
  }

  private readProperties(depth: number): Record<string, Amf0Value> {
    const result: Record<string, Amf0Value> = {};
    for (;;) {
      const key = this.readUtf8(2);
      this.ensure(1);
      if (key === "" && this.data[this.offset] === 0x09) {
        this.offset++;
        return result;
      }
      result[key] = this.read(depth + 1);
    }
  }

  read(depth = 0): Amf0Value {
    if (depth > MAX_DEPTH) throw new Amf0Error("AMF0 nesting too deep");
    this.ensure(1);
    const marker = this.data[this.offset++];
    switch (marker) {
      case 0x00: {
        this.ensure(8);
        const value = this.data.readDoubleBE(this.offset);
        this.offset += 8;
        return value;
      }
      case 0x01:
        this.ensure(1);
        return this.data[this.offset++] !== 0;
      case 0x02:
        return this.readUtf8(2);
      case 0x03:
        return this.readProperties(depth);
      case 0x05:
        return null;
      case 0x06:
        return undefined;
      case 0x08: // ECMA array: count hint, then properties like an object
        this.ensure(4);
        this.offset += 4;
        return this.readProperties(depth);
      case 0x0a: {
        this.ensure(4);
        const count = this.data.readUInt32BE(this.offset);
        this.offset += 4;
        const items: Amf0Value[] = [];
        for (let i = 0; i < count; i++) items.push(this.read(depth + 1));
        return items;
      }
      case 0x0b: {
        this.ensure(10);
        const ms = this.data.readDoubleBE(this.offset);
        this.offset += 10; // 8 bytes time + 2 bytes time zone (unused)
        return new Date(ms);
      }
      case 0x0c:
        return this.readUtf8(4);
      default:
        throw new Amf0Error(`unsupported AMF0 marker 0x${(marker ?? 0).toString(16)}`);
    }
  }
}

export function decodeAmf0All(data: Buffer): Amf0Value[] {
  const reader = new Amf0Reader(data);
  const values: Amf0Value[] = [];
  while (!reader.done) values.push(reader.read());
  return values;
}

/** Encodes an AMF0 string value (marker + u16 length + UTF-8). */
export function encodeAmf0String(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const buf = Buffer.allocUnsafe(3 + bytes.length);
  buf[0] = 0x02;
  buf.writeUInt16BE(bytes.length, 1);
  bytes.copy(buf, 3);
  return buf;
}
