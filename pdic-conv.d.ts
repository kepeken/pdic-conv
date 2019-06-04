export function readPDIC(arrayBuffer: ArrayBuffer): Entry[];

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
