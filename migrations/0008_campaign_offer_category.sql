-- Win-back offers propose a CATEGORY, not a specific item (unlike
-- complete_the_set, which always has an item_id) -- so excluding an already-
-- dismissed win-back nudge from reappearing needs the category persisted too,
-- the same way complete_the_set's dismissal exclusion uses item_id.
ALTER TABLE campaign_offer ADD COLUMN category TEXT;
