# Install LoveCloud v0.1.0

Start with the [complete installation guide](SELF_HOSTING.md): requirements,
archive verification, ready-made image setup, HTTPS and private remote access.

- [Release downloads](https://github.com/m0rp3x/LoveCloud/releases/tag/v0.1.0)
- [First setup](SETUP.md)
- [Access model and limits](LIMITATIONS.md)
- [Tailscale](TAILSCALE.md)
- [Operations](OPERATIONS.md)

Quick start from an extracted installation archive:

```sh
sh scripts/init.sh --start
```

```powershell
./scripts/init.ps1 -Start
```

Ready-made Linux amd64 images are pinned in `compose.images.yaml`; no source
compilation or Node/.NET SDK is needed. Keep the printed setup link private.
