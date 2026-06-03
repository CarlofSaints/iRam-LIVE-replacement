/**
 * Aged Stock parser — stub.
 * File format details pending from user.
 * Will be implemented once a sample file is provided.
 */

export interface AgedStockParseResult {
  rows: Record<string, unknown>[];
  totalRows: number;
}

export function parseAgedStock(_buffer: Buffer): AgedStockParseResult {
  throw new Error(
    "Aged Stock parsing is not yet implemented — file format pending"
  );
}
