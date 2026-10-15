# Deployment checklist

## Resource ownership (verified)
- [New independent GitHub repository](https://github.com/ACIDCH/personal-immersive-translator) (public).
- Dedicated Supabase project `ligamejpnracymxfbbff`, region `ap-southeast-2`, first-phase no schema or table changes.
- [YUNPAN project directory](https://drive.google.com/drive/folders/1EddQ28j6XRMAknfe0lcEfuSlQwdkoO05), isolated `docs` / `releases` / `backups`.

## Checks
- `npm run verify`
- Load unpacked extension on Chrome and Edge.
- Smoke test a static text webpage, dynamic webpage and blocked domain.
- Configure one official standard-translation API key and test live; test AI only after explicit cost consent.
- Check restore, selection and permission boundaries.
- Inspect GitHub Actions, CSP warnings, extensions error logs and credentials.

## Release policy
Treat Alpha as unverified until real-browser and real-API tests pass. Do not merge third-party GPL code into the independent MIT implementation without a license review. Do not reuse other project resources, tokens, databases or secrets.
