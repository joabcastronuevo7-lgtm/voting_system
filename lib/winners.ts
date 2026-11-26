import type { ResultRow } from "./contracts";

export type Award = {
  id: string;
  name: string;
  description: string;
  /** votes for each winner; 0 when nobody received any */
  votes: number;
  /** every nominee ranked first: more than one is a tie */
  winners: string[];
};

/** One award per category, in the order the rows arrive. Other places are dropped. */
export function winners(rows: ResultRow[]): Award[] {
  const awards = new Map<string, Award>();
  for (const row of rows) {
    let award = awards.get(row.category_id);
    if (!award) {
      award = {
        id: row.category_id,
        name: row.category_name,
        description: row.category_description,
        votes: 0,
        winners: [],
      };
      awards.set(row.category_id, award);
    }
    if (row.rank === 1 && row.nominee_name !== null) {
      award.votes = row.votes;
      award.winners.push(row.nominee_name);
    }
  }
  return [...awards.values()];
}
