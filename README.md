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

Nothing is compared in raw pixels or millimeters. Each result is a **share across the relatives who have that feature** (Dad 70%, Mom 30%), from distances, not a standalone similarity percent. One relative is “only Mom to compare,” not 100%. A gap smaller than the noise — using the distance between the adults as the yardstick — is “too close to call.”

- **Shape (main signal for the front and the side silhouette).** The MediaPipe points for that region (both eyes, both brows, the nose, the lips, the jaw, the cheeks, the face oval, or the profile nose and chin) are rotated with the head-pose matrix toward a frontal frame, then compared with Procrustes distance so position, size, and leftover rotation drop out. A few ratios (eye tilt, nose width over face width, and so on) stay as a small extra.
- **Appearance.** A DINOv2-small embedding of the crop, after slow lighting is flattened. The model is downloaded once from this site (about 24 MB), cached in the browser, and run on-device. It is not a gradient histogram.
- **Ears.** The face mesh stops at the ear canal. The app places a box just behind that point, tightens it with skin color or edges, and compares a Procrustes outline, a Fourier outline, and the same embedding. Left only with left, right only with right.

“Show the math” on the results lists the raw distances, the share, and which signal separated the relatives. The overall line and the tally use these shares. This is visual resemblance, not a genetic test.

## Saved on this phone

People, photos, and measurements are stored in IndexedDB. The app asks the browser to keep that data (`navigator.storage.persist()`).

Saved photos from an older measurement version are detected on open and measured again automatically. The people and the photo files stay; a progress line shows whose photo is updating. **Re-run comparison** does that again on purpose. **Save backup** / **Restore backup** writes or reads a JSON file of the people and their photos. Restoring measures them with the current pipeline. Starting over deletes everything. The results screen can also export a score JSON (no photos) and a summary image.

## Limits

- Very dark profiles, profiles where the ear is hidden by hair, and some extreme angles still fail the face detector. The screen asks for a retake instead of inventing a match.
- A hat, bangs, glasses, or a big smile changes the forehead, eyes, or lips.
- Baby proportions really are different. A high score means the photos look alike, not that a trait was inherited.
- The percent is a calibrated similarity, not a probability.

## Pages

Pushes to `main` build the app and deploy `dist/` with `actions/upload-pages-artifact` and `actions/deploy-pages`. The Vite `base` path is `/baby-features/`.
