/**
 * A value that is safe to pass through `JSON.stringify` without data loss.
 *
 * Mirrors the server-side type. Defined separately to avoid importing server
 * modules into the client bundle.
 */
export type JsonSerializable =
  | string
  | number
  | boolean
  | null
  | JsonSerializable[]
  | { [key: string]: JsonSerializable };

export interface RenderErrorDigest<
  Code extends string = string,
  Data extends JsonSerializable = JsonSerializable,
> {
  code: Code;
  data: Data;
}
