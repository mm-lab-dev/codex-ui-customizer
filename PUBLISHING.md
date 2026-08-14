# Publishing Checklist

## 1. Choose a Marketplace Publisher ID

Create a publisher in the Visual Studio Marketplace and change:

```json
"publisher": "mm-lab"
```

in `package.json` to your actual Publisher ID.

If your Publisher ID is `mm-lab`, no change is needed.

## 2. Repository metadata

The Marketplace repository, issue tracker, and homepage are configured as:

```json
"repository": {
  "type": "git",
  "url": "https://github.com/mm-lab-dev/codex-ui-customizer.git"
},
"bugs": {
  "url": "https://github.com/mm-lab-dev/codex-ui-customizer/issues"
},
"homepage": "https://github.com/mm-lab-dev/codex-ui-customizer#readme"
```

## 3. Package and inspect

```bash
npx @vscode/vsce ls
npm run package
```

Test the generated VSIX on both:

- Local VS Code, if desired
- Remote-SSH where Codex runs remotely

## 4. Publish

After authenticating your Marketplace publisher:

```bash
npm run publish
```

Or upload the generated VSIX manually from the Marketplace publisher management page.

## 5. Release notes

Update `CHANGELOG.md` for every release and bump `version` in `package.json`.
