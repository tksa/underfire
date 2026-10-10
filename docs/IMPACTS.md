# Shell contact and terrain damage

Direct-fire contact effects travel with the tracer and run once on arrival.
Machine guns on tanks use small-arms effects. HE strength comes from the weapon's
blast profile; low-blast penetrators kick dirt forward and throw a short directional burst. Targeted HE against infantry now has a visible contact burst, instead of
only a muzzle flash and an unrelated deep hole.

Effects use a brief flash, surface-colored dust, up to nine flying clods, and
a subdued scorch mark for larger blasts. Rain reduces dust; water produces pale spray; roads and
masonry chip without digging a soil crater. The debris uses one reusable
128-instance mesh. Dust emission and persistent scars have explicit caps.

Crater depth is limited by radius and capped at 0.32 world units. Overlapping
hits saturate rather than subtracting depth indefinitely. Impacts smaller than
the terrain grid do not move isolated vertices.
Larger impacts modify only a local grid window, with one normal update per
batch. Height sampling includes deformation so units and scars remain grounded.

Combat HP, ammunition and suppression retain their existing simulation timing.
The visual arrival event never repeats damage, building destruction, LOS smoke
or fire ignition. Mortars retain their actual flight and impact damage timing.

`scripts/impact-fx-test.mjs` checks arrival delivery, surfaces, repeated impacts,
height sampling, small-crater rejection, and resource lifetimes/caps.

The rejected bright-rimmed soil decal was removed after visual review. Small
shell impacts no longer stamp permanent circles over the grass. Authored vehicle
texture detail is preserved; the strong faction recoloring shader was withdrawn.
