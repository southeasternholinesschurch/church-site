---
name: "Pastor [Full Name]"
role: "Pastor"
order: 1
# Names a key in site/src/lib/staff-assets.ts, NOT a filename — a typo here
# cannot break the build, it just shows a "Photo needed" marker instead.
photo: "pastor"
# Vertical focal point for the circular crop, as a percentage. The circle keeps
# only the middle ~56% of a tall photo, so 50% clips the top of the head on a
# seated portrait. 22% is the default for a reason; measure against YOUR photo.
focus: 22
---

One or two short paragraphs. Who they are, how long they have been here, and
something a visitor would actually want to know — not a CV.

Delete this file and add one per person. `order` controls the sequence.
