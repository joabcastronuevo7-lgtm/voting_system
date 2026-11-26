// Response shapes returned by the database functions.

export type VotingStatus = "not_started" | "open" | "paused" | "closed";

/** `guest_me()` */
export type GuestState = {
  full_name: string;
  has_voted: boolean;
  voting_status: VotingStatus;
  registration_open: boolean;
};

export type Category = { id: string; name: string; description: string };
export type Nominee = { id: string; full_name: string };

/** `ballot_nominees()` */
export type Ballot = { categories: Category[]; nominees: Nominee[] };

/** Any unusable claim link. The same answer whether or not the token ever existed. */
export type ClaimFailure = { ok: false; error: "INVALID_CLAIM" };
export type ClaimPreview = ClaimFailure | { ok: true; full_name: string };
export type ClaimResult = ClaimFailure | { ok: true; full_name: string; expires_at: string };

/** `admin_dashboard()`. Turnout only: no award data. */
export type Dashboard = {
  registered: number;
  eligible: number;
  ballots_cast: number;
  registration_open: boolean;
  voting_status: VotingStatus;
  max_active_guests: number;
};

/** `admin_list_guests()`. Vote times are deliberately not exposed. */
export type AdminGuest = {
  id: string;
  full_name: string;
  registered_at: string;
  has_voted: boolean;
  removed_at: string | null;
  removal_reason: string | null;
};

/** One row of published results. */
export type ResultRow = {
  category_id: string;
  category_name: string;
  category_description: string;
  sort_order: number;
  /** null with 0 votes and null rank when a category has no votes */
  nominee_name: string | null;
  votes: number;
  rank: number | null;
};

/**
 * `public_results()` and `admin_results()`. Published only while voting status is
 * `closed`, for admins too.
 */
export type Results =
  | { published: false; results: [] }
  | { published: true; results: ResultRow[] };
