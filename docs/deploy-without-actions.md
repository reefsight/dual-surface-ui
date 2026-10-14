# Build and distribute without GitHub Actions

This repository is an npm library, not a hosted web service. It builds and packages locally without GitHub Actions:

```sh
./scripts/build-local.sh
```

The command runs npm ci, npm run build (TypeScript plus the existing Angular compiler), and npm pack. Tarballs go to /tmp/dual-surface-ui-package by default; set ARTIFACT_DIR to an absolute destination to keep the result elsewhere. Install the resulting tarball in a consumer with npm install /path/to/dual-surface-ui-VERSION.tgz.

Publishing to an npm registry requires the intended registry, package name/version and publishing credentials. Packing does not publish, overwrite an existing release or create a production service. For registry distribution, review npm pack --dry-run and the package version before npm publish. Keep Actions disabled.
