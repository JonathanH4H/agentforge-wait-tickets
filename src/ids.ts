import { randomBytes } from "node:crypto";

export type IdPrefix = "tkt" | "clm" | "mtr";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomBytes(12).toString("hex")}`;
}
