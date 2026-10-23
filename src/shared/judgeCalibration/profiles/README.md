# Committed profiles: none qualify yet

No (technique, family, engine) has a fitted profile today. JEVBENCH2
measured seven scenarios per identity — far short of the 200
independent labels per family the parser requires — and lane V's
independent sets have not run. Until a fit qualifies, every
model-backed family reports its own `profile-missing` and stays off;
the deterministic checks carry the fast path alone.

A profile lands here only through the rules in
`src/shared/judgeCalibration/README.md`, with its fit's date and
label set in the envelope.
