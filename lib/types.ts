export type Category = {
  id: string;
  name: string;
};

export type Direction = "in" | "out";

export type Entry = {
  id: string;
  amount: number;
  direction: Direction;
  category_id: string;
  entry_date: string;
  note: string | null;
  is_recurring: boolean;
  starts_period: boolean | null;
};
