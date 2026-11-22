/** Small runtime type guards shared across modules. */

export function isNonEmptyStr(str: unknown): str is string {
  return typeof str === `string` && str.length > 0;
}

export function isPlainObj(obj: unknown): obj is Record<string, unknown> {
  return typeof obj === `object` && obj !== null && !Array.isArray(obj);
}

export function isValidRecordId(recordId: unknown): recordId is `rec${string}` {
  return (
    typeof recordId === `string` &&
    recordId.length >= 10 &&
    recordId.startsWith(`rec`)
  );
}
