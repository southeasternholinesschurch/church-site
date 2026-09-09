# Put your church's logo files here

Referenced by `site/src/lib/*-assets.ts`. Names matter — keep them and swap the
image.

| filename | what it is |
|---|---|
| `logo-on-dark.png` | wordmark that reads on a DARK background |
| `logo-on-light.png` | the same mark for LIGHT backgrounds |
| `mark.png` | the icon alone, square-ish, for the app icon and favicon |

**Trim the transparent margin off before you commit them.** A logo with a wide
empty border renders at about half its intended size inside a fixed box, and it
looks like a bug rather than a margin. This cost a day on the original build.

**Check contrast both ways.** A pale mark on a cream page is invisible even
though it looks fine in the file. Aim for at least 4.5:1 against whatever it
sits on; a mark that works on ink usually washes out on cream, which is why
there are two files rather than one.

Ministry logos are optional — a ministry without one simply shows its name, and
nothing looks broken.
