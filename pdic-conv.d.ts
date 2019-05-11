export function readPDIC(arrayBuffer: ArrayBuffer, writeEntry: (entry: Entry) => void): void;

interface Entry {
  keyword: string;
  word: string;
  trans: string;
  exp?: string;
  level: number;
  memory: boolean;
  modify: boolean;
  pron?: string;
  // linkdata
}
