# Unit scale audit

The broad rescaling pass was withdrawn after the user's visual review. Runtime
units retain their established size tuning. The R35 precise-geometry ground snap
remains; it avoids the old imported-box height error without changing its size.

`scripts/unit-scale-audit.mjs` measures 41 core models using visible vertices and
can render common-camera comparisons with infantry. The audit found trucks and
some crew weapons need individual attention. A blanket length fit distorted
the apparent crew relationship on models with inaccurate source proportions.
Those adjustments remain outstanding; the proposed sizes are not accepted art.

The standing infantry height anchor is 1.24 world units. Posed soldiers are
shorter while leaning or crouching. Scenery uses this height against a nominal
1.75m person. Tactical distance conversion remains independent of model sizing.

Future scale fixes need a visible side-by-side review of hull, tracks/wheels,
crew reach, muzzle position and clearance. The existing MODEL_PIPELINE.md lists
reference dimensions. Native bounds alone are insufficient: some source assets
have exaggerated proportions or non-body appendages.
