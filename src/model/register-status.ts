import { z } from "zod";

/**
 * Computed from ESMA dates — never copied from a field.
 * Describes what the register says, not a compliance verdict.
 * See ADR 0002 §D3.
 */
export const RegisterStatusSchema = z.enum([
  "authorised",
  "authorisation_date_missing",
  "withdrawn",
  "delisted", // set by B4 diff; never assigned in B3
]);

export type RegisterStatus = z.infer<typeof RegisterStatusSchema>;
