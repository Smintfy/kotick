/**
 * A value that JSON can hold.
 * JSON.parse() gives only such values, so it can type what a component shows or what the overlay stores.
 */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
