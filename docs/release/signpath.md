# Signing the Windows installer with SignPath

Windows installers are signed for free by [SignPath Foundation](https://signpath.org),
which signs open-source releases built by a public CI. The release workflow
(`.github/workflows/release.yml`, job `windows`) refuses to publish an unsigned
installer, so until the steps below are done the Windows job fails and every
other platform still ships.

## One-time setup

1. **Apply** at <https://signpath.org/apply> with the repository
   `https://github.com/grimfeld/synesis`. The project already meets the terms
   (<https://signpath.org/terms>): AGPL-3.0 (OSI-approved), no proprietary code,
   built from source by GitHub Actions, a released version, and the "Code
   signing policy" and privacy text in the README.
2. **Turn on multi-factor authentication** on GitHub and on SignPath. The terms
   require it for every team member.
3. Once accepted, in SignPath:
   - add the predefined **GitHub.com** Trusted Build System and link it to the
     project;
   - install the **SignPath GitHub App** on the repository;
   - name the project `synesis` and the signing policy `release-signing`, or
     set the repository variables `SIGNPATH_PROJECT_SLUG` and
     `SIGNPATH_POLICY_SLUG` to the names you chose;
   - set the policy's file metadata restrictions: product name `Synesis`;
   - create the two artifact configurations below.
4. **Create a SignPath API token** for a user with the Submitter role.
5. **Give it to the workflow:**

   ```sh
   gh secret set SIGNPATH_API_TOKEN            # paste the token
   gh variable set SIGNPATH_ORGANIZATION_ID    # paste the organization id (not secret)
   ```

## Artifact configurations

`windows-exe`, the app before it is put into the installers:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="synesis.exe">
      <authenticode-sign />
    </pe-file>
  </zip-file>
</artifact-configuration>
```

`windows-installers`, the NSIS setup and the MSI built around the signed app:

```xml
<?xml version="1.0" encoding="utf-8"?>
<artifact-configuration xmlns="http://signpath.io/artifact-configuration/v1">
  <zip-file>
    <pe-file path="*-setup.exe">
      <authenticode-sign />
    </pe-file>
    <msi-file path="*.msi">
      <authenticode-sign />
    </msi-file>
  </zip-file>
</artifact-configuration>
```

## Each release

SignPath Foundation requires a person to approve every signing request. A
release makes two (the app, then the installers): approve each in SignPath
while the Windows job waits. It waits up to two hours per request.

## Why the build is split

SignPath signs only files a GitHub workflow built and uploaded as an artifact,
which is how it proves where they came from. So the job builds the app with
`--no-bundle`, has it signed, bundles the installers around the signed app
with `tauri bundle`, and has those signed. The updater signatures
(`*.sig`, checked by the in-app updater against the public key in
`tauri.conf.json`) are made last, over the signed files, and the
`updater-windows` job adds them to the release's `latest.json`.
