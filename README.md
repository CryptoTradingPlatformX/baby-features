# Baby Features

See which family member a baby’s ears, eyes, nose, and other features look most like. Everything runs in the browser. Photos stay on the phone.

The site is a static Vite app and is published with GitHub Pages from this repository.

## Run it locally

```bash
npm install
npm run dev
```

Open the URL Vite prints. The first time you add a photo, the app downloads a face model (about 4 MB) and the MediaPipe runtime from this same site. `npm run dev` and `npm run build` fetch those files into `public/` if they are not there yet. They are not committed.

```bash
npm test
npm run build
npm run preview
```

## How a photo is read

1. **Face Landmarker** (MediaPipe Tasks, float16 model, CPU) finds up to three faces and 478 landmarks, plus a few expression scores such as blink and open mouth. The largest face is the one that gets measured. The model runs on-device. The picture is not uploaded.
2. If the first pass finds no face, the photo is tried again at several rotations. Side photos of a baby are often tilted.
3. Head angle comes from scale-free cues: how much one eye is foreshortened compared with the other, and face width divided by face height. A straight-on photo, a halfway turn, and a real side view are treated differently. The visible side is the ear landmark that sits farther from the nose, checked against landmark depth.
4. Blurry, dark, blown-out, or cut-off faces ask for a retake. A warning (soft focus, open mouth, hat over the forehead) can still be kept.

## How features are compared

Baby faces are smaller and rounder than adult faces, so nothing is compared in raw pixels or millimeters.

- **Proportions** are ratios: eye shape, nose width relative to the face, lip fullness, jaw taper, and a normalized outline of the face. Rotating or resizing the photo does not change them.
- **Appearance** is a histogram of oriented gradients on a crop that has been scaled to a fixed size. That keeps the comparison about shape and shading, not about how close the camera was.
- **Front photos** supply face shape, forehead, eyebrows, eyes, nose, lips, chin and jaw, and cheeks.
- **Side photos** supply the ear on that side, the nose silhouette, and the chin silhouette. A missing angle is skipped and labeled “not enough photos.” It is not scored as a zero.

### Ears

The face mesh stops at the ear canal, so it does not trace the outer ear. For a side view the app:

1. Places a box just behind the visible ear-canal landmark. The box height follows the brow-to-nose distance, which is the usual proportion for an ear, so a baby’s ear and an adult’s ear can be compared.
2. Tightens that box with skin color, or with strong edges when the photo is black and white or very dark.
3. Describes the crop with the gradient histogram plus the magnitudes of a Fourier series of the outline. Both are scale-invariant.

Left ears are only compared with left ears, and right with right.

Similarity is a mix of those descriptions, shown as a percent. The overall line weights ears and eyes a little more than the whole face shape, because a baby’s face is rounder than the adults they look like. This is a visual resemblance, not a genetic test.

## Saved on this phone

People, photos, and measurements are stored in IndexedDB in this browser. Starting over deletes them. Export writes a JSON file of the scores (no photos) and a summary image.

## Limits

- Very dark profiles, profiles where the ear is hidden by hair, and some extreme angles still fail the face detector. The screen asks for a retake instead of inventing a match.
- A hat, bangs, glasses, or a big smile changes the forehead, eyes, or lips.
- Baby proportions really are different. A high score means the photos look alike, not that a trait was inherited.
- The percent is a calibrated similarity, not a probability.

## Pages

Pushes to `main` build the app and deploy `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`. The Vite `base` path is `/baby-features/`.
