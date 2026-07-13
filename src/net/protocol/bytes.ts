/**
 * Byte-level writer/reader over a DataView. Used for the hot-path packets
 * (inputs, snapshots) where msgpack overhead isn't worth it. Little-endian.
 * The writer's buffer is reusable (call `reset`) to avoid per-packet allocation.
 */

export class ByteWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private off = 0;

  constructor(capacity = 1024) {
    this.buf = new ArrayBuffer(capacity);
    this.view = new DataView(this.buf);
  }

  reset(): this {
    this.off = 0;
    return this;
  }

  private ensure(bytes: number): void {
    if (this.off + bytes <= this.buf.byteLength) return;
    const next = new ArrayBuffer(Math.max(this.buf.byteLength * 2, this.off + bytes));
    new Uint8Array(next).set(new Uint8Array(this.buf, 0, this.off));
    this.buf = next;
    this.view = new DataView(next);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.off, v);
    this.off += 1;
    return this;
  }

  i8(v: number): this {
    this.ensure(1);
    this.view.setInt8(this.off, v);
    this.off += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.off, v, true);
    this.off += 2;
    return this;
  }

  i16(v: number): this {
    this.ensure(2);
    this.view.setInt16(this.off, v, true);
    this.off += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.off, v, true);
    this.off += 4;
    return this;
  }

  /** Copy of the written bytes (safe to hand to a transport). */
  bytes(): Uint8Array {
    return new Uint8Array(this.buf.slice(0, this.off));
  }

  get length(): number {
    return this.off;
  }
}

export class ByteReader {
  private readonly view: DataView;
  private off = 0;

  constructor(data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u8(): number {
    const v = this.view.getUint8(this.off);
    this.off += 1;
    return v;
  }

  i8(): number {
    const v = this.view.getInt8(this.off);
    this.off += 1;
    return v;
  }

  u16(): number {
    const v = this.view.getUint16(this.off, true);
    this.off += 2;
    return v;
  }

  i16(): number {
    const v = this.view.getInt16(this.off, true);
    this.off += 2;
    return v;
  }

  u32(): number {
    const v = this.view.getUint32(this.off, true);
    this.off += 4;
    return v;
  }

  get remaining(): number {
    return this.view.byteLength - this.off;
  }
}
