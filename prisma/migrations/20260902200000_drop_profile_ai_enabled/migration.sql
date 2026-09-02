-- The per-profile AI switch is gone; the prepaid balance is the only gate now.
--
-- Two controls for one decision was the problem: a profile could be "enabled"
-- while its user had no credit, or funded while the profile was switched off,
-- and neither screen explained the other. Balance is the one that maps to
-- money actually being spent, so it is the one that stays.
--
-- Dropping the column rather than leaving it dead on purpose: a boolean still
-- sitting on the model is an invitation for something to start reading it
-- again, and a gate that only half the code respects is worse than no gate.
ALTER TABLE `profiles`
  DROP COLUMN `ai_enabled`;
